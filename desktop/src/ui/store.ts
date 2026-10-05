import { initialControls } from "./initialState.ts";

export type ControlId = keyof typeof initialControls;
export interface ControlState {
  text: string;
  value: string;
  disabled: boolean;
  hidden: boolean;
  checked: boolean;
  open: boolean;
  state: string;
  options: { value: string; label: string }[];
}
export interface RetainedResult {
  sessionId: string;
  transcript: string;
  outputText: string;
}
type RetainedAction = "original" | "output" | "discard";
type Handler = (event: Event) => unknown;

// The session controller publishes view state, never HTML. Each control has a
// cached immutable snapshot so React can subscribe without restarting recording.
export function createUiStore() {
  const listeners = new Set<() => void>();
  const actions = new Map<string, Handler[]>();
  const elements = new Map<ControlId, HTMLElement>();
  const snapshots = new Map<ControlId, ControlState>();
  const models = new Map<ControlId, ControlState>();
  let pending = false;
  let active = false;
  let logs: readonly string[] = [];
  let retained: { results: readonly RetainedResult[]; locked: boolean } = {
    results: [],
    locked: false,
  };
  const keyListeners = new Set<
    (key: { state: string; busy: boolean }) => void
  >();
  let keyState = { state: "unknown", busy: false };
  let retainedHandler:
    ((action: RetainedAction, sessionId: string) => void) | undefined;

  function flush() {
    if (!pending) return;
    pending = false;
    for (const listener of listeners) listener();
  }
  function changed() {
    if (pending) return;
    pending = true;
    queueMicrotask(flush);
  }
  for (const id of Object.keys(initialControls) as ControlId[]) {
    const initial: ControlState = {
      text: "",
      value: "",
      disabled: false,
      hidden: false,
      checked: false,
      open: false,
      state: "",
      options: [],
      ...structuredClone(initialControls[id]),
    };
    snapshots.set(id, initial);
    models.set(
      id,
      new Proxy(initial, {
        set(target, property: keyof ControlState, value) {
          if (Object.is(target[property], value)) return true;
          Reflect.set(target, property, value);
          snapshots.set(id, { ...target });
          changed();
          return true;
        },
      }),
    );
    // Never mutate a snapshot after publishing it.
    snapshots.set(id, { ...initial });
  }
  return {
    control: (id: ControlId) => models.get(id)!,
    snapshot: (id: ControlId) => snapshots.get(id)!,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    flush,
    on(id: ControlId, event: string, handler: Handler) {
      const key = `${id}:${event}`;
      actions.set(key, [...(actions.get(key) ?? []), handler]);
      return () => {
        actions.set(
          key,
          (actions.get(key) ?? []).filter((candidate) => candidate !== handler),
        );
      };
    },
    dispatch(id: ControlId, event: string, payload: Event) {
      for (const handler of actions.get(`${id}:${event}`) ?? [])
        handler(payload);
    },
    attach(id: ControlId, element: HTMLElement | null) {
      if (element) elements.set(id, element);
      else elements.delete(id);
    },
    element<T extends HTMLElement>(id: ControlId): T {
      const element = elements.get(id);
      if (!element) throw new Error(`UI control is not mounted: ${id}`);
      return element as T;
    },
    focus(id: ControlId) {
      elements.get(id)?.focus();
    },
    active: () => active,
    setActive(value: boolean) {
      if (active !== value) {
        active = value;
        changed();
      }
    },
    keyState: () => keyState,
    setKeyState(value: typeof keyState) {
      keyState = value;
      for (const listener of keyListeners) listener(value);
    },
    onKeyState(listener: (value: typeof keyState) => void) {
      keyListeners.add(listener);
      listener(keyState);
      return () => {
        keyListeners.delete(listener);
      };
    },
    logs: () => logs,
    addLog(line: string) {
      logs = [line, ...logs];
      changed();
    },
    clearLog() {
      logs = [];
      changed();
    },
    retained: () => retained,
    setRetained(results: readonly RetainedResult[], locked: boolean) {
      retained = { results: results.map((result) => ({ ...result })), locked };
      changed();
    },
    onRetained(handler: typeof retainedHandler) {
      retainedHandler = handler;
    },
    retainedAction(action: RetainedAction, sessionId: string) {
      retainedHandler?.(action, sessionId);
    },
  };
}

export const ui = createUiStore();
