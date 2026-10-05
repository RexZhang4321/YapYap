import { View } from "./View";

export function ProcessingTimes() {
  return (
    <View
      as="section"
      id="processing-timings"
      className="session-panel"
      aria-labelledby="timing-heading"
    >
      <h2 id="timing-heading">Processing time</h2>
      <dl className="processing-times">
        <dt>Audio preparation</dt>
        <View as="dd" id="timing-preparation" />
        <dt>Transcription request</dt>
        <View as="dd" id="timing-transcription" />
        <dt>Cleanup request</dt>
        <View as="dd" id="timing-cleanup" />
        <dt>Destination check</dt>
        <View as="dd" id="timing-destination" />
        <dt>Paste and clipboard restore</dt>
        <View as="dd" id="timing-insertion" />
        <View as="dt" id="timing-total-label" className="timing-total" />
        <View as="dd" id="timing-total" className="timing-total" />
      </dl>
      <p className="hint">
        Request times include upload and response handling. Timings stay in
        memory for the current dictation.
      </p>
    </View>
  );
}
