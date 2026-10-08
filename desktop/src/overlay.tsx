import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openApp } from "#platform";
import {
  OverlayReceiver,
  overlayPresentation,
  type OverlaySnapshot,
} from "./overlayState";
import "./overlay.css";

export function Overlay() {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot>({
    epoch: 0,
    revision: 0,
    phase: "hidden",
    text: "",
    preview: "off",
    hasGap: false,
  });
  const [failed, setFailed] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);
  const copy = overlayPresentation(snapshot);
  useLayoutEffect(() => {
    if (text.current) text.current.scrollTop = text.current.scrollHeight;
  }, [copy.text]);
  useEffect(() => {
    const receiver = new OverlayReceiver();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const receive = (value: OverlaySnapshot) => {
      if (!disposed && receiver.accept(value)) {
        setSnapshot(value);
        setFailed(false);
      }
    };
    void (async () => {
      // Subscribe first; revision guards reject a snapshot overtaken by events.
      unlisten = await listen<OverlaySnapshot>("overlay-state", (event) =>
        receive(event.payload),
      );
      if (disposed) {
        unlisten();
        return;
      }
      receive(await invoke<OverlaySnapshot>("overlay_snapshot"));
    })().catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return (
    <main
      id="overlay"
      data-phase={snapshot.phase}
      data-warning={String(copy.warning)}
      role="status"
      aria-live="polite"
    >
      <header>
        <span className="signal" aria-hidden="true" />
        <h1 id="overlay-title">
          {failed ? openApp : copy.title}
        </h1>
        <span className="brand" id="overlay-label">
          {copy.label}
        </span>
      </header>
      <p id="overlay-text" ref={text}>
        {copy.text}
      </p>
      <p id="overlay-hint">{copy.hint}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Overlay />);
