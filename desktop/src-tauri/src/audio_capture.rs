//! Native microphone capture for builds whose WebView cannot record while hidden.
//! WebKit stops delivering microphone audio to a hidden window, so the Mac build
//! records with AVAudioEngine and streams mono Float32 chunks to the main window.
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};

#[cfg(target_os = "macos")]
mod macos;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCaptureStarted {
    sample_rate: f64,
    channel_count: u32,
    device_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCaptureStopped {
    callbacks: u64,
}

/// Starts capture; `events` receives raw little-endian mono Float32 chunks,
/// then JSON `{"type":"ended"}` on device loss and `{"type":"flushed"}` on stop.
#[tauri::command]
pub async fn start_native_capture(
    device_name: Option<String>,
    events: Channel<InvokeResponseBody>,
) -> Result<NativeCaptureStarted, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || macos::start(device_name, events))
            .await
            .map_err(|_| "microphone_start_failed".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (device_name, events);
        Err("microphone_native_unsupported".into())
    }
}

#[tauri::command]
pub async fn stop_native_capture() -> Result<NativeCaptureStopped, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(macos::stop)
            .await
            .map_err(|_| "microphone_stop_failed".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("microphone_native_unsupported".into())
    }
}

/// Averages deinterleaved channels into mono Float32 little-endian bytes.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn mono_bytes(channels: &[&[f32]]) -> Vec<u8> {
    let frames = channels
        .iter()
        .map(|channel| channel.len())
        .min()
        .unwrap_or(0);
    let scale = 1.0 / channels.len().max(1) as f32;
    let mut bytes = Vec::with_capacity(frames * 4);
    for frame in 0..frames {
        let sum: f32 = channels.iter().map(|channel| channel[frame]).sum();
        bytes.extend_from_slice(&(sum * scale).to_le_bytes());
    }
    bytes
}

/// Matches a WebView microphone label to a Core Audio input name. WebKit uses
/// the device name, sometimes with a suffix, so prefer exact then prefix matches.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn choose_device<'a, T>(label: &str, devices: &'a [(T, String)]) -> Option<&'a T> {
    devices
        .iter()
        .find(|(_, name)| name == label)
        .or_else(|| {
            devices
                .iter()
                .filter(|(_, name)| !name.is_empty() && label.starts_with(name.as_str()))
                .max_by_key(|(_, name)| name.len())
        })
        .map(|(id, _)| id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_bytes_averages_channels_and_stops_at_the_shortest() {
        let left = [0.5f32, -1.0, 0.25];
        let right = [0.5f32, 1.0];
        let bytes = mono_bytes(&[&left, &right]);
        let samples: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
            .collect();
        assert_eq!(samples, vec![0.5, 0.0]);
        assert!(mono_bytes(&[]).is_empty());
        assert_eq!(mono_bytes(&[&left]).len(), 12);
    }

    #[test]
    fn device_choice_prefers_exact_then_longest_prefix() {
        let devices = vec![
            (1, "MacBook Pro Microphone".to_string()),
            (2, "USB Mic".to_string()),
            (3, "USB Mic Pro".to_string()),
        ];
        assert_eq!(choose_device("MacBook Pro Microphone", &devices), Some(&1));
        assert_eq!(choose_device("USB Mic Pro (0d8c:0014)", &devices), Some(&3));
        assert_eq!(choose_device("USB Mic", &devices), Some(&2));
        assert_eq!(choose_device("Unplugged headset", &devices), None);
    }
}
