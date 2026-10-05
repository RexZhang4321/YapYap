export interface RecoveryCopyChoice {
  sessionId: string;
  text: string;
  source: "original" | "provisional";
  stopWaiting: boolean;
}

// The dialog presents this immutable snapshot. Rejecting it must not cancel a
// request, write the clipboard, or dispatch a paste.
export async function confirmRecoveryCopy(choice: RecoveryCopyChoice, actions: {
  confirm(choice: RecoveryCopyChoice): Promise<boolean>;
  isCurrent(choice: RecoveryCopyChoice): boolean;
  stopWaiting(): boolean;
  copy(text: string): Promise<void>;
}): Promise<boolean> {
  if (!await actions.confirm(choice) || !actions.isCurrent(choice)) return false;
  if (choice.stopWaiting && !actions.stopWaiting()) return false;
  await actions.copy(choice.text);
  return true;
}
