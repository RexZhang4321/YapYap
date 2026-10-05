import { View } from "./View";
import { RetainedList } from "./RetainedList";
export function LivePreview() {
  return (
    <View
      as="section"
      id="live-panel"
      className="session-panel"
      aria-labelledby="live-heading"
    >
      <div className="section-heading">
        <View as="h2" id="live-heading" />
        <span className="text-badge">{"Preview"}</span>
      </div>
      <View as="p" id="live-status" role="status" />
      <label className="sr-only" htmlFor="live-transcript">
        {"Live preview, may change"}
      </label>
      <View
        as="textarea"
        id="live-transcript"
        className="live-text"
        rows={3}
        readOnly
        spellCheck={false}
        placeholder="Your words will appear as you speak."
      />
      <View as="button" id="live-reconnect" type="button" />
      <View as="div" id="provisional-recovery" className="recovery-actions">
        <p className="hint">
          {"These live words may be incomplete. Review them before pasting."}
        </p>
        <View as="button" id="copy-provisional" type="button" />
        <details className="clipboard-options">
          <summary>{"Clipboard options"}</summary>
          <View
            as="button"
            id="copy-provisional-without-backup"
            type="button"
          />
          <p className="hint">
            {"Use only if Copy cannot preserve the current clipboard."}
          </p>
        </details>
        <View as="p" id="provisional-copy-status" role="status" />
      </View>
    </View>
  );
}

export function SessionRecovery() {
  return (
    <View
      as="section"
      id="recovery-panel"
      className="session-panel"
      aria-labelledby="recovery-heading"
    >
      <div className="section-heading">
        <View as="h2" id="recovery-heading" />
        <View
          as="button"
          id="discard-transcription"
          type="button"
          className="quiet-button"
        />
      </div>
      <View as="p" id="transcription-status" role="status" />
      <View as="p" id="cleanup-status" className="hint" role="status" />
      <View as="div" id="processing-recovery" className="recovery-actions">
        <View as="p" id="processing-recovery-hint" className="hint" />
        <div className="row">
          <View
            as="button"
            id="bypass-processing"
            type="button"
            className="primary-button"
          />
          <View as="button" id="stop-waiting" type="button" />
        </div>
        <View as="p" id="recovery-copy-status" role="status" />
      </View>
      <View as="div" id="audio-recovery">
        <View as="audio" id="recording-playback" controls />
        <div className="row recording-actions">
          <View
            as="button"
            id="transcribe-recording"
            type="button"
            className="primary-button"
          />
          <View as="button" id="play-recording" type="button" />
          <View as="button" id="stop-playback" type="button" />
        </div>
        <p className="hint">
          {
            "Your recording stays in memory for retry until you discard it or quit."
          }
        </p>
      </View>
      <View as="div" id="current-result">
        <View as="div" id="cleaned-transcript-panel">
          <label htmlFor="cleaned-transcript">{"Text for insertion"}</label>
          <View
            as="textarea"
            id="cleaned-transcript"
            rows={4}
            readOnly
            spellCheck={false}
          />
        </View>
        <div className="row recording-actions">
          <View
            as="button"
            id="copy-transcript"
            type="button"
            className="primary-button"
          />
          <View as="button" id="copy-original" type="button" />
        </div>
        <View as="p" id="copy-status" role="status" />
        <View
          as="details"
          id="original-transcript-panel"
          className="original-panel"
        >
          <summary>{"Original transcript"}</summary>
          <label className="sr-only" htmlFor="transcript">
            {"Original transcript"}
          </label>
          <View
            as="textarea"
            id="transcript"
            rows={4}
            readOnly
            spellCheck={false}
          />
          <p className="hint">
            {"The original words are kept separately from cleanup."}
          </p>
        </View>
        <details className="clipboard-options">
          <summary>{"Clipboard options"}</summary>
          <div className="row">
            <View
              as="button"
              id="copy-transcript-without-backup"
              type="button"
            />
            <View as="button" id="copy-original-without-backup" type="button" />
          </div>
          <p className="hint">
            {"Use only if Copy cannot preserve the current clipboard."}
          </p>
        </details>
      </View>
    </View>
  );
}

export function ClipboardRecovery() {
  return (
    <View as="section" id="clipboard-recovery" className="clipboard-recovery">
      <p className="hint">{"A previous clipboard copy is available."}</p>
      <View as="button" id="restore-clipboard" type="button" />
    </View>
  );
}

export function RetainedResults() {
  return (
    <View
      as="section"
      id="retained-panel"
      className="session-panel"
      aria-labelledby="retained-heading"
    >
      <div className="section-heading">
        <View as="h2" id="retained-heading" />
        <span className="text-badge">{"In memory"}</span>
      </div>
      <p className="hint">
        {
          "Originals remain available as you dictate again. Discard them when finished; quitting clears them."
        }
      </p>
      <View as="p" id="retained-copy-status" role="status" />
      <View as="ul" id="retained-results" className="retained-results">
        <RetainedList />
      </View>
    </View>
  );
}
