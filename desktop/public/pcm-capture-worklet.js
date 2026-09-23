const BLOCK_SIZE = 4096;

class PcmCaptureWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BLOCK_SIZE);
    this.offset = 0;
    this.processCalls = 0;
    this.lastInputChannels = -1;
    this.port.onmessage = (event) => {
      if (event.data?.type === "flush") this.flush();
    };
  }

  process(inputs, outputs) {
    this.processCalls += 1;
    const inputChannels = inputs[0]?.length ?? 0;
    if (this.processCalls === 1 || inputChannels !== this.lastInputChannels) {
      this.lastInputChannels = inputChannels;
      this.port.postMessage({
        type: "diagnostics",
        processCalls: this.processCalls,
        inputChannels,
      });
    }

    const input = inputs[0]?.[0];
    if (input) this.append(input);

    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
    return true;
  }

  append(input) {
    let sourceOffset = 0;
    while (sourceOffset < input.length) {
      const count = Math.min(BLOCK_SIZE - this.offset, input.length - sourceOffset);
      this.buffer.set(input.subarray(sourceOffset, sourceOffset + count), this.offset);
      this.offset += count;
      sourceOffset += count;
      if (this.offset === BLOCK_SIZE) this.postBuffer(this.buffer);
    }
  }

  flush() {
    if (this.offset > 0) this.postBuffer(this.buffer.slice(0, this.offset));
    this.port.postMessage({
      type: "diagnostics",
      processCalls: this.processCalls,
      inputChannels: this.lastInputChannels,
    });
    this.port.postMessage({ type: "flushed" });
  }

  postBuffer(buffer) {
    this.port.postMessage({ type: "pcm", buffer: buffer.buffer }, [buffer.buffer]);
    this.buffer = new Float32Array(BLOCK_SIZE);
    this.offset = 0;
  }
}

registerProcessor("byok-pcm-capture", PcmCaptureWorkletProcessor);
