import {
  createElement,
  useCallback,
  useSyncExternalStore,
  type JSX,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { ui, type ControlId } from "./store";

export function useUi<T>(snapshot: () => T) {
  return useSyncExternalStore(ui.subscribe, snapshot, snapshot);
}

type HtmlTag = keyof JSX.IntrinsicElements & keyof HTMLElementTagNameMap;
type ViewProps<Tag extends HtmlTag> = {
  as: Tag;
  id: ControlId;
} & Omit<
  ComponentPropsWithoutRef<Tag>,
  | "id"
  | "ref"
  | "hidden"
  | "disabled"
  | "value"
  | "checked"
  | "open"
  | "onChange"
>;

// Shared bindings keep simple status labels and controlled inputs consistent.
// Feature-specific markup and interaction live in the surrounding components.
export function View<Tag extends HtmlTag>({
  as,
  id,
  children,
  ...attributes
}: ViewProps<Tag>) {
  const state = useUi(() => ui.snapshot(id));
  const inputType = (attributes as { type?: string }).type;
  const ref = useCallback(
    (element: HTMLElement | null) => {
      ui.attach(id, element);
    },
    [id],
  );
  const event = (name: string) => (event: SyntheticEvent) =>
    ui.dispatch(id, name, event.nativeEvent);
  const props: Record<string, unknown> = {
    ...attributes,
    id,
    ref,
    hidden: state.hidden,
  };
  if (as === "button" || as === "input" || as === "select" || as === "textarea")
    props.disabled = state.disabled;
  if (state.state) props["data-state"] = state.state;
  if (as === "button") {
    props.onClick = event("click");
    if (state.value) props.value = state.value;
  }
  if (as === "form") props.onSubmit = event("submit");
  if (as === "audio") {
    props.onPlay = event("play");
    props.onPause = event("pause");
    props.onEnded = event("ended");
  }
  if (as === "details") {
    props.open = state.open;
    props.onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
      ui.control(id).open = event.currentTarget.open;
    };
  }
  if (as === "input" || as === "select" || as === "textarea") {
    if (inputType === "checkbox") props.checked = state.checked;
    else props.value = state.value;
    props.onChange = (event: SyntheticEvent<HTMLInputElement>) => {
      const model = ui.control(id);
      if (inputType === "checkbox") model.checked = event.currentTarget.checked;
      else model.value = event.currentTarget.value;
      ui.dispatch(id, "change", event.nativeEvent);
      ui.dispatch(id, "input", event.nativeEvent);
    };
  }
  if (as === "meter") props.value = Number(state.value);
  let content: ReactNode = children ?? state.text;
  if (as === "select")
    content = state.options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ));
  if (as === "input" || as === "textarea" || as === "meter")
    return createElement(as, props);
  return createElement(as, props, content);
}

export function EventLog() {
  const logs = useUi(ui.logs);
  return (
    <ol id="events">
      {logs.map((line, index) => (
        <li key={`${line}:${index}`}>{line}</li>
      ))}
    </ol>
  );
}
