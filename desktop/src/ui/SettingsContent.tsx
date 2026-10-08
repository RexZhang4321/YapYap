import { View, EventLog } from "./View";
import { ApiKeySettings } from "./ApiKeySettings";
import { showOverlayFixture } from "#platform";

export function SettingsContent() {
  return (
    <div className="settings-content">
      <ApiKeySettings />
      <section
        className="settings-section"
        aria-labelledby="microphone-heading"
      >
        <div className="section-heading">
          <View as="h3" id="microphone-heading" />
          <View
            as="button"
            id="refresh-devices"
            type="button"
            className="quiet-button"
          />
        </div>
        <label className="sr-only" htmlFor="microphone">
          {"Microphone input device"}
        </label>
        <View as="select" id="microphone" />
        <View as="p" id="microphone-access-help" className="hint" />
        <View as="button" id="prepare-microphone" type="button" />
      </section>
      <section className="settings-section" aria-labelledby="shortcut-heading">
        <View as="h3" id="shortcut-heading" />
        <p className="hint">
          {"Choose a shortcut you can comfortably hold while speaking."}
        </p>
        <View as="form" id="shortcut-form">
          <label className="sr-only" htmlFor="shortcut">
            {"Recorded shortcut"}
          </label>
          <div className="row">
            <View
              as="input"
              id="shortcut"
              readOnly
              spellCheck={false}
              aria-describedby="shortcut-capture-hint"
            />
            <View as="button" id="apply-shortcut" type="submit" />
          </div>
          <View
            as="button"
            id="shortcut-record"
            type="button"
            className="record-shortcut"
          />
        </View>
        <View as="p" id="shortcut-capture-hint" className="hint" />
        <View as="p" id="status" role="status" />
      </section>
      <section
        className="settings-section"
        aria-labelledby="preferences-heading"
      >
        <View as="h3" id="preferences-heading" />
        <label className="check-row">
          <View as="input" id="live-enabled" type="checkbox" />
          <span>
            {"Show live words"}
            <View as="span" id="live-enabled-help" className="hint" />
          </span>
        </label>
        <label className="check-row">
          <View as="input" id="cleanup-enabled" type="checkbox" />
          <span>
            {"Light cleanup"}
            <span className="hint">
              {
                "Tidy punctuation and spoken fillers. Keep the original transcript."
              }
            </span>
          </span>
        </label>
        <p className="hint">
          {
            "Cleanup sends the original transcript directly to OpenAI. Turn it off to insert the original words."
          }
        </p>
      </section>
      <View as="details" id="diagnostics" className="diagnostics">
        <summary>{"Developer diagnostics"}</summary>
        <p className="hint">
          {
            "Optional capability checks. Normal dictation uses Dictate and insert."
          }
        </p>
        <label htmlFor="hotkey-action">{"Shortcut test mode"}</label>
        <View as="select" id="hotkey-action" />
        <div className="states">
          <span>
            {"Key "}
            <View as="strong" id="hold-state" />
          </span>
          <span>
            {"Session "}
            <View as="strong" id="session-state" />
          </span>
        </div>
        <div className="meter-group">
          <label htmlFor="input-level">{"Microphone input level"}</label>
          <View
            as="meter"
            id="input-level"
            min={0}
            max={0.5}
            low={0.03}
            high={0.25}
            optimum={0.12}
          />
          <View as="span" id="input-level-status" />
        </div>
        <View as="p" id="recording-status" role="status" />
        <View as="p" id="recording-metadata" className="metadata" />
        <View as="button" id="clear-recording" type="button" />
        <View as="p" id="overlay-status" className="hint" role="status" />
        {showOverlayFixture && (
          <div className="row">
            <View as="button" id="probe-overlay-show" type="button" />
            <View as="button" id="probe-overlay-hide" type="button" />
          </div>
        )}
        <View as="p" id="live-latency" className="metadata" />
        <h3>{"Text insertion test"}</h3>
        <p>
          <View as="code" id="test-text" />
        </p>
        <View as="p" id="insertion-status" role="status" />
        <div className="row">
          <View as="button" id="copy-text" type="button" />
          <View as="button" id="copy-without-backup" type="button" />
        </div>
        <div className="section-heading log-heading">
          <h3>{"Events"}</h3>
          <View
            as="button"
            id="clear-log"
            type="button"
            className="quiet-button"
          />
        </div>
        <EventLog />
      </View>
    </div>
  );
}
