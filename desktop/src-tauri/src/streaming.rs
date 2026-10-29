//! Provisional STT only. Credentials and authenticated sockets remain native.
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeBody, Request};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    sync::{mpsc, watch, Notify},
    time::{timeout, Instant},
};
use tokio_tungstenite::{
    tungstenite::{client::IntoClientRequest, protocol::WebSocketConfig, Error, Message},
    WebSocketStream,
};

const MAX_CHUNK: usize = 9_600; // 200 ms of 24 kHz mono PCM16.
const QUEUE_SIZE: usize = 32;
const MAX_EVENT: usize = 1024 * 1024;
const NETWORK_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveEvent {
    stream_id: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
}

impl LiveEvent {
    fn status(id: &str, kind: &'static str) -> Self {
        Self {
            stream_id: id.into(),
            kind,
            item_id: None,
            text: None,
            code: None,
        }
    }
}

enum Input {
    Audio(Vec<u8>),
    Finish,
}
struct Worker {
    id: String,
    sender: mpsc::Sender<Input>,
    cancel: watch::Sender<bool>,
    finishing: AtomicBool,
    finished: AtomicBool,
    done: Notify,
}

#[derive(Default)]
pub struct LiveState(Mutex<Option<Arc<Worker>>>);
impl Drop for LiveState {
    fn drop(&mut self) {
        if let Ok(Some(worker)) = self.0.get_mut() {
            let _ = worker.cancel.send(true);
        }
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

fn worker(state: &LiveState, id: &str) -> Result<Arc<Worker>, String> {
    state
        .0
        .lock()
        .map_err(|_| "live_operation_failed".to_string())?
        .as_ref()
        .filter(|w| w.id == id && !w.finished.load(Ordering::Acquire))
        .cloned()
        .ok_or_else(|| "live_stale_stream".into())
}

#[tauri::command]
pub fn start_live_stream(
    stream_id: String,
    events: Channel<LiveEvent>,
    state: tauri::State<'_, LiveState>,
) -> Result<(), String> {
    if !valid_id(&stream_id) {
        return Err("live_stale_stream".into());
    }
    let mut active = state
        .0
        .lock()
        .map_err(|_| "live_operation_failed".to_string())?;
    if active
        .as_ref()
        .is_some_and(|w| !w.finished.load(Ordering::Acquire))
    {
        return Err("live_busy".into());
    }
    let (sender, receiver) = mpsc::channel(QUEUE_SIZE);
    let (cancel, mut cancelled) = watch::channel(false);
    let worker = Arc::new(Worker {
        id: stream_id,
        sender,
        cancel,
        finishing: AtomicBool::new(false),
        finished: AtomicBool::new(false),
        done: Notify::new(),
    });
    *active = Some(worker.clone());
    tauri::async_runtime::spawn(async move {
        let id = worker.id.clone();
        let emit = |event: LiveEvent| {
            events
                .send(event)
                .map_err(|_| "live_view_closed".to_string())
        };
        // Dropping the connect/send/receive future closes its owned socket and buffers.
        // Cancellation does not depend on queue capacity or provider responsiveness.
        tokio::select! {
            biased;
            _ = cancelled.changed() => {},
            result = async {
                let socket = OpenAiStreamingSTT.connect().await?;
                stream(socket, receiver, &id, &emit).await
            } => {
                if let Err(code) = result {
                    let mut event = LiveEvent::status(&id, "error"); event.code = Some(code);
                    let _ = emit(event);
                } else { let _ = emit(LiveEvent::status(&id, "closed")); }
            }
        }
        worker.finished.store(true, Ordering::Release);
        worker.done.notify_waiters();
    });
    Ok(())
}

#[tauri::command]
pub fn append_live_audio(
    request: Request<'_>,
    state: tauri::State<'_, LiveState>,
) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-live-stream")
        .and_then(|v| v.to_str().ok())
        .ok_or("live_stale_stream")?;
    let worker = worker(&state, id)?;
    if worker.finishing.load(Ordering::Acquire) {
        return Err("live_stale_stream".into());
    }
    let audio = match request.body() {
        InvokeBody::Raw(audio)
            if !audio.is_empty() && audio.len() <= MAX_CHUNK && audio.len() % 2 == 0 =>
        {
            audio
        }
        _ => return Err("live_audio_invalid".into()),
    };
    worker
        .sender
        .try_send(Input::Audio(audio.clone()))
        .map_err(|error| {
            match error {
                mpsc::error::TrySendError::Full(_) => "live_backlog",
                _ => "live_disconnected",
            }
            .into()
        })
}

#[tauri::command]
pub fn finish_live_stream(
    stream_id: String,
    state: tauri::State<'_, LiveState>,
) -> Result<(), String> {
    let worker = worker(&state, &stream_id)?;
    if worker.finishing.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    worker
        .sender
        .try_send(Input::Finish)
        .map_err(|_| "live_backlog".into())
}

#[tauri::command]
pub async fn cancel_live_stream(
    stream_id: String,
    state: tauri::State<'_, LiveState>,
) -> Result<(), String> {
    let worker = match worker(&state, &stream_id) {
        Ok(worker) => worker,
        Err(_) => return Ok(()),
    };
    let _ = worker.cancel.send(true);
    // Register before checking the flag, avoiding a lost completion notification.
    let done = worker.done.notified();
    tokio::pin!(done);
    done.as_mut().enable();
    if !worker.finished.load(Ordering::Acquire) {
        timeout(NETWORK_TIMEOUT, done)
            .await
            .map_err(|_| "live_timeout".to_string())?;
    }
    Ok(())
}

trait StreamingSTT {
    async fn connect(
        &self,
    ) -> Result<WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, String>;
}
struct OpenAiStreamingSTT;
impl StreamingSTT for OpenAiStreamingSTT {
    async fn connect(
        &self,
    ) -> Result<WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, String>
    {
        let request = tauri::async_runtime::spawn_blocking(|| {
            crate::credentials::with_api_key(|key| {
                let mut request = "wss://api.openai.com/v1/realtime?intent=transcription"
                    .into_client_request()
                    .map_err(|_| "live_operation_failed".to_string())?;
                let header = zeroize::Zeroizing::new(format!("Bearer {key}"));
                let mut value = header
                    .parse::<tokio_tungstenite::tungstenite::http::HeaderValue>()
                    .map_err(|_| "key_format".to_string())?;
                value.set_sensitive(true);
                request.headers_mut().insert("Authorization", value);
                Ok(request)
            })
        })
        .await
        .map_err(|_| "live_operation_failed".to_string())??;
        let mut config = WebSocketConfig::default();
        config.max_message_size = Some(MAX_EVENT);
        config.max_frame_size = Some(MAX_EVENT);
        // native-tls validates the hostname and certificate using the platform trust store.
        // This client does not follow redirects. Never render a handshake error.
        timeout(
            NETWORK_TIMEOUT,
            tokio_tungstenite::connect_async_with_config(request, Some(config), true),
        )
        .await
        .map_err(|_| "live_timeout".to_string())?
        .map(|(socket, _)| socket)
        .map_err(socket_error)
    }
}

fn socket_error(error: Error) -> String {
    match error {
        Error::Http(response) => match response.status().as_u16() {
            401 => "live_unauthorized",
            403 => "live_forbidden",
            404 => "live_model_unavailable",
            429 => "live_rate_limited",
            300..=399 => "live_redirect",
            500..=599 => "live_provider_unavailable",
            _ => "live_request_rejected",
        },
        Error::Tls(_) => "live_tls_failed",
        Error::Capacity(_) => "live_response_too_large",
        _ => "live_disconnected",
    }
    .into()
}

fn configuration() -> Message {
    Message::Text(
        json!({"type":"session.update","session":{"type":"transcription","audio":{"input":{
            "format":{"type":"audio/pcm","rate":24000},
            "transcription":{"model":"gpt-live-transcribe","delay":"low"},"turn_detection":null
        }}}})
        .to_string()
        .into(),
    )
}

fn provider_event(value: &Value, id: &str) -> Result<Option<LiveEvent>, String> {
    let kind = match value["type"].as_str() {
        Some("session.updated" | "transcription_session.updated") => "ready",
        Some("conversation.item.input_audio_transcription.delta") => "delta",
        Some("conversation.item.input_audio_transcription.completed") => "completed",
        Some("error" | "conversation.item.input_audio_transcription.failed") => {
            // Classify only a small code allowlist; no provider message/body leaves Rust.
            return Err(match value["error"]["code"].as_str().unwrap_or("") {
                "invalid_api_key" => "live_unauthorized",
                "model_not_found" => "live_model_unavailable",
                "rate_limit_exceeded" | "insufficient_quota" => "live_rate_limited",
                _ => "live_request_rejected",
            }
            .into());
        }
        _ => return Ok(None),
    };
    let mut event = LiveEvent::status(id, kind);
    if kind != "ready" {
        let item = value["item_id"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 128)
            .ok_or("live_response_invalid")?;
        let text = value[if kind == "delta" {
            "delta"
        } else {
            "transcript"
        }]
        .as_str()
        .ok_or("live_response_invalid")?;
        if text.len() > MAX_EVENT {
            return Err("live_response_too_large".into());
        }
        event.item_id = Some(item.into());
        event.text = Some(text.into());
    }
    Ok(Some(event))
}

async fn stream<S: AsyncRead + AsyncWrite + Unpin>(
    mut socket: WebSocketStream<S>,
    mut audio: mpsc::Receiver<Input>,
    id: &str,
    emit: &impl Fn(LiveEvent) -> Result<(), String>,
) -> Result<(), String> {
    timeout(NETWORK_TIMEOUT, socket.send(configuration()))
        .await
        .map_err(|_| "live_timeout".to_string())?
        .map_err(socket_error)?;
    let mut ready = false;
    let mut finishing = false;
    let mut bytes_sent = 0;
    let mut deadline = Instant::now() + NETWORK_TIMEOUT;
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline), if !ready || finishing => return Err("live_timeout".into()),
            message = socket.next() => {
                let message = message.ok_or("live_disconnected")?.map_err(socket_error)?;
                match message {
                    Message::Text(text) => {
                        let value: Value = serde_json::from_str(&text).map_err(|_| "live_response_invalid".to_string())?;
                        if let Some(event) = provider_event(&value, id)? {
                            if event.kind == "ready" { ready = true; }
                            let completed = event.kind == "completed";
                            emit(event)?;
                            if finishing && completed {
                                let _ = timeout(Duration::from_millis(500), socket.close(None)).await;
                                return Ok(());
                            }
                        }
                    }
                    Message::Close(_) => return Err("live_disconnected".into()),
                    Message::Ping(_) => { timeout(NETWORK_TIMEOUT, socket.flush()).await.map_err(|_| "live_timeout".to_string())?.map_err(socket_error)?; }
                    Message::Binary(_) => return Err("live_response_invalid".into()),
                    _ => {}
                }
            }
            input = audio.recv(), if ready && !finishing => {
                let message = match input {
                    Some(Input::Audio(bytes)) => {
                        bytes_sent += bytes.len();
                        Message::Text(json!({"type":"input_audio_buffer.append","audio":STANDARD.encode(bytes)}).to_string().into())
                    }
                    Some(Input::Finish) => {
                        if bytes_sent < 4_800 { let _ = timeout(Duration::from_millis(500), socket.close(None)).await; return Ok(()); }
                        finishing = true; deadline = Instant::now() + NETWORK_TIMEOUT;
                        Message::Text(json!({"type":"input_audio_buffer.commit"}).to_string().into())
                    }
                    None => return Ok(()),
                };
                timeout(NETWORK_TIMEOUT, socket.send(message)).await.map_err(|_| "live_timeout".to_string())?.map_err(socket_error)?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configuration_preserves_requested_model_and_disables_server_vad() {
        let value: Value = serde_json::from_str(configuration().to_text().unwrap()).unwrap();
        assert_eq!(
            value["session"]["audio"]["input"]["transcription"]["model"],
            "gpt-live-transcribe"
        );
        assert_eq!(value["session"]["audio"]["input"]["format"]["rate"], 24_000);
        assert!(value["session"]["audio"]["input"]["turn_detection"].is_null());
    }
    #[test]
    fn transcript_events_preserve_unicode_and_redact_failure_messages() {
        let event = provider_event(&json!({"type":"conversation.item.input_audio_transcription.delta","item_id":"item_1","delta":"你好 🦆 src/main.ts"}), "s1").unwrap().unwrap();
        assert_eq!(event.text.unwrap(), "你好 🦆 src/main.ts");
        assert_eq!(
            provider_event(
                &json!({"type":"error","error":{"code":"unknown","message":"private fixture"}}),
                "s1"
            )
            .err()
            .unwrap(),
            "live_request_rejected"
        );
        assert!(provider_event(&json!({"type":"conversation.item.input_audio_transcription.delta","delta":"missing id"}), "s1").is_err());
    }

    async fn sockets() -> (
        WebSocketStream<tokio::io::DuplexStream>,
        WebSocketStream<tokio::io::DuplexStream>,
    ) {
        let (client, server) = tokio::io::duplex(65_536);
        tokio::join!(
            WebSocketStream::from_raw_socket(
                client,
                tokio_tungstenite::tungstenite::protocol::Role::Client,
                None
            ),
            WebSocketStream::from_raw_socket(
                server,
                tokio_tungstenite::tungstenite::protocol::Role::Server,
                None
            )
        )
    }

    #[tokio::test]
    async fn streams_audio_and_deltas_before_commit_then_reconciles_completion() {
        let (client, mut server) = sockets().await;
        let (sender, receiver) = mpsc::channel(QUEUE_SIZE);
        let observed = Arc::new(Mutex::new(Vec::new()));
        let events = observed.clone();
        let task = tokio::spawn(async move {
            stream(client, receiver, "fixture", &|event| {
                events.lock().unwrap().push(event);
                Ok(())
            })
            .await
        });
        let config = server.next().await.unwrap().unwrap();
        assert_eq!(config, configuration());
        // Input queues until the provider acknowledges its configuration.
        sender.send(Input::Audio(vec![42; 4_800])).await.unwrap();
        server
            .send(Message::Text(
                json!({"type":"session.updated"}).to_string().into(),
            ))
            .await
            .unwrap();
        let append: Value =
            serde_json::from_str(server.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(append["type"], "input_audio_buffer.append");
        assert_eq!(
            STANDARD.decode(append["audio"].as_str().unwrap()).unwrap(),
            vec![42; 4_800]
        );
        server.send(Message::Text(json!({"type":"conversation.item.input_audio_transcription.delta","item_id":"one","delta":"Hello"}).to_string().into())).await.unwrap();
        timeout(Duration::from_secs(1), async {
            while !observed
                .lock()
                .unwrap()
                .iter()
                .any(|event: &LiveEvent| event.kind == "delta")
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        sender.send(Input::Finish).await.unwrap();
        let commit: Value =
            serde_json::from_str(server.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(commit["type"], "input_audio_buffer.commit");
        server.send(Message::Text(json!({"type":"conversation.item.input_audio_transcription.completed","item_id":"one","transcript":"Hello!"}).to_string().into())).await.unwrap();
        let _ = server.next().await;
        let _ = server.close(None).await;
        assert!(task.await.unwrap().is_ok());
        let events = observed.lock().unwrap();
        assert_eq!(
            events.iter().map(|e| e.kind).collect::<Vec<_>>(),
            ["ready", "delta", "completed"]
        );
        assert_eq!(events.last().unwrap().text.as_deref(), Some("Hello!"));
    }

    #[tokio::test]
    async fn native_queue_is_bounded_and_stale_stream_ids_are_rejected() {
        let (sender, _receiver) = mpsc::channel(QUEUE_SIZE);
        let (cancel, _cancelled) = watch::channel(false);
        let worker = Arc::new(Worker {
            id: "current".into(),
            sender,
            cancel,
            finishing: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            done: Notify::new(),
        });
        let state = LiveState(Mutex::new(Some(worker.clone())));
        assert!(super::worker(&state, "previous").is_err());
        for _ in 0..QUEUE_SIZE {
            worker
                .sender
                .try_send(Input::Audio(vec![0; MAX_CHUNK]))
                .unwrap();
        }
        assert!(matches!(
            worker.sender.try_send(Input::Finish),
            Err(mpsc::error::TrySendError::Full(_))
        ));
        worker.finished.store(true, Ordering::Release);
        assert!(super::worker(&state, "current").is_err());
    }

    #[tokio::test]
    async fn cancellation_drops_socket_and_queued_audio_while_waiting_for_configuration() {
        let (client, mut server) = sockets().await;
        let (sender, receiver) = mpsc::channel(QUEUE_SIZE);
        let (cancel, mut cancelled) = watch::channel(false);
        sender.send(Input::Audio(vec![0; MAX_CHUNK])).await.unwrap();
        let task = tokio::spawn(async move {
            tokio::select! {
                biased;
                _ = cancelled.changed() => {},
                _ = stream(client, receiver, "fixture", &|_| Ok(())) => panic!("provider should still be waiting"),
            }
        });
        let _ = server.next().await;
        cancel.send(true).unwrap();
        timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
        assert!(sender.is_closed());
        assert!(server.next().await.unwrap().is_err());
    }

    #[tokio::test]
    async fn closed_socket_returns_only_a_fixed_error() {
        let (client, mut server) = sockets().await;
        let (_sender, receiver) = mpsc::channel(QUEUE_SIZE);
        let task =
            tokio::spawn(async move { stream(client, receiver, "fixture", &|_| Ok(())).await });
        let _ = server.next().await;
        server.close(None).await.unwrap();
        assert_eq!(task.await.unwrap().unwrap_err(), "live_disconnected");
    }

    #[tokio::test]
    #[ignore = "Real OpenAI connection with the saved key; no microphone/audio upload"]
    async fn saved_key_live_configuration_probe() {
        let mut socket = OpenAiStreamingSTT
            .connect()
            .await
            .expect("fixed live connection error");
        socket
            .send(configuration())
            .await
            .map_err(socket_error)
            .unwrap();
        timeout(NETWORK_TIMEOUT, async {
            loop {
                let message = socket
                    .next()
                    .await
                    .ok_or("live_disconnected")?
                    .map_err(socket_error)?;
                if let Message::Text(text) = message {
                    let value: Value = serde_json::from_str(&text)
                        .map_err(|_| "live_response_invalid".to_string())?;
                    if let Some(event) = provider_event(&value, "probe")? {
                        if event.kind == "ready" {
                            return Ok::<_, String>(());
                        }
                    }
                }
            }
        })
        .await
        .expect("live_timeout")
        .expect("fixed configuration error");
        let _ = timeout(Duration::from_millis(500), socket.close(None)).await;
    }
}
