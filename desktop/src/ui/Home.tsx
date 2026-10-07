import { View } from "./View";
import appIcon from "../assets/app-icon.png";
export function AppHeader() {
  return (
    <header className="app-header">
      <div className="wordmark">
        <img className="app-mark" src={appIcon} alt="" aria-hidden="true" />
        <h1>{"YapYap"}</h1>
      </div>
      <View
        as="button"
        id="open-settings"
        type="button"
        className="quiet-button"
      />
    </header>
  );
}

export function Readiness() {
  return (
    <View
      as="section"
      id="home-panel"
      className="readiness"
      aria-labelledby="dictation-status"
    >
      <div className="readiness-heading">
        <span className="readiness-dot" aria-hidden="true" />
        <View as="h2" id="dictation-status" role="status" />
      </div>
      <View as="p" id="dictation-detail" className="hint" role="status" />
      <View
        as="div"
        id="dictation-alert"
        className="dictation-alert"
        role="alert"
      >
        <View as="p" id="dictation-alert-text" />
      </View>
      <p className="shortcut-intro">{"Hold your shortcut in any text field"}</p>
      <View as="kbd" id="shortcut-display" className="shortcut-display" />
      <p className="dictation-instruction">
        {"Speak, then release to insert your words."}
      </p>
      <div className="cancel-row">
        <View as="p" id="cancel-hint" className="hint" />
        <View
          as="button"
          id="cancel-dictation"
          type="button"
          className="danger-button"
        />
      </div>
    </View>
  );
}

export function SetupCallout() {
  return (
    <View
      as="section"
      id="setup-callout"
      className="setup-callout"
      aria-label="Setup"
    >
      <div>
        <h2>{"One-time setup"}</h2>
        <View as="p" id="setup-message" />
      </div>
      <View
        as="button"
        id="open-setup"
        type="button"
        className="primary-button"
      />
    </View>
  );
}

export function ProcessingOptions() {
  return (
    <section
      className="session-panel"
      aria-labelledby="processing-options-heading"
    >
      <h2 id="processing-options-heading">{"Processing phases"}</h2>
      <label className="check-row">
        <View as="input" id="full-audio-enabled" type="checkbox" />
        <span>
          {"Full audio transcription"}
          <span className="hint">
            {
              "Transcribe the complete recording for accuracy. Turn off to use the completed live words."
            }
          </span>
        </span>
      </label>
      <label className="check-row">
        <View as="input" id="main-cleanup-enabled" type="checkbox" />
        <span>
          {"gpt-6-luna cleanup"}
          <span className="hint">
            {
              "Tidy punctuation and spoken fillers. Turn off to insert the transcript as received."
            }
          </span>
        </span>
      </label>
    </section>
  );
}

export function AppFooter() {
  return (
    <footer className="app-footer">
      <span className="privacy-indicator" aria-hidden="true" />
      <p>{"Your key. Direct to OpenAI."}</p>
      <p>{"Close to keep dictating from the tray."}</p>
    </footer>
  );
}
