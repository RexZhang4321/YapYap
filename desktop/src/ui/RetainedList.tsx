import { useUi } from "./View";
import { ui } from "./store";
import { useRef } from "react";
import { flushSync } from "react-dom";

export function RetainedList() {
  const { results, locked } = useUi(ui.retained);
  const summaries = useRef(new Map<string, HTMLElement>());
  function discard(sessionId: string) {
    // Removing the focused row should leave the keyboard on another usable control.
    flushSync(() => {
      ui.retainedAction("discard", sessionId);
      ui.flush();
    });
    const next = summaries.current.values().next().value;
    if (next) next.focus();
    else ui.focus("open-settings");
  }
  return results.map((result, index) => {
    const label = `Earlier dictation ${results.length - index}`;
    return (
      <li key={result.sessionId}>
        <details data-session-id={result.sessionId}>
          <summary
            data-action="summary"
            ref={(element) => {
              if (element) summaries.current.set(result.sessionId, element);
              else summaries.current.delete(result.sessionId);
            }}
          >
            {label}
          </summary>
          <textarea
            value={result.transcript}
            readOnly
            rows={3}
            aria-label={`${label} original transcript`}
          />
          <div className="row recording-actions">
            <button
              type="button"
              disabled={locked}
              onClick={() => ui.retainedAction("original", result.sessionId)}
            >
              Copy original
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => ui.retainedAction("output", result.sessionId)}
            >
              Copy output
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => discard(result.sessionId)}
            >
              Discard
            </button>
          </div>
        </details>
      </li>
    );
  });
}
