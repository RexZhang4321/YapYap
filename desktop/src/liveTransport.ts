import { Channel, invoke } from "@tauri-apps/api/core";
import type { LiveEvent, StreamingSTT } from "./liveTranscription";

export const nativeStreamingSTT: StreamingSTT = {
  async start(streamId, receive) {
    const events = new Channel<LiveEvent>();
    events.onmessage = receive;
    await invoke("start_live_stream", { streamId, events });
  },
  async append(streamId, audio) {
    await invoke("append_live_audio", audio, { headers: { "x-live-stream": streamId } });
  },
  async finish(streamId) { await invoke("finish_live_stream", { streamId }); },
  async cancel(streamId) { await invoke("cancel_live_stream", { streamId }); },
};
