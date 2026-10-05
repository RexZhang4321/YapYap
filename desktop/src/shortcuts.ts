export interface ShortcutKey {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat: boolean;
}

export function shortcutFromKey(event: ShortcutKey): string | null {
  if (event.repeat || /^(Control|Alt|Shift|Meta)/.test(event.code)) return null;
  const code = event.code;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3)
    : /^Digit[0-9]$/.test(code) ? code.slice(5)
    : /^F([1-9]|1[0-9]|2[0-4])$/.test(code) ? code
    : ({ Space: "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
      Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete" } as Record<string, string>)[code];
  if (!key || (!event.ctrlKey && !event.altKey && !event.metaKey)) return null;
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super", key].filter(Boolean).join("+");
}

// Registration is transactional: a conflict leaves the working shortcut intact.
export class ShortcutBinding {
  active: string | null = null;
  private changing = false;
  private suspended = false;
  constructor(private readonly register: (shortcut: string) => Promise<void>,
    private readonly unregister: (shortcut: string) => Promise<void>) {}
  get available() { return this.active !== null && !this.suspended; }
  async apply(next: string): Promise<boolean> {
    if (this.changing) return false;
    if (next === this.active) { await this.resume(); return true; }
    this.changing = true;
    const previous = this.active;
    try {
      try { await this.register(next); }
      catch (error) { await this.resume(); throw error; }
      try { if (previous && !this.suspended) await this.unregister(previous); }
      catch (error) {
        await this.unregister(next).catch(() => undefined);
        throw error;
      }
      this.active = next;
      this.suspended = false;
      return true;
    } finally { this.changing = false; }
  }
  async suspend() {
    if (this.changing || this.suspended) return;
    if (this.active) await this.unregister(this.active);
    this.suspended = true;
  }
  async resume() {
    if (!this.suspended) return;
    if (this.active) await this.register(this.active);
    this.suspended = false;
  }
}

// Only intercept Escape while a session can still be cancelled. Reconciliation
// is serialized so a delayed register cannot leave Escape captured after idle.
export class ScopedShortcut {
  private desired = false;
  private registered = false;
  private running: Promise<void> | null = null;
  private registrationFailed = false;
  constructor(private readonly register: () => Promise<void>, private readonly unregister: () => Promise<void>,
    private readonly availability: (available: boolean) => void) {}
  setActive(active: boolean) {
    this.desired = active;
    if (!active) this.registrationFailed = false;
    if (!this.running && this.desired !== this.registered && !(active && this.registrationFailed)) this.running = this.reconcile().finally(() => { this.running = null; });
    return this.running ?? Promise.resolve();
  }
  private async reconcile() {
    while (this.desired !== this.registered) {
      const next = this.desired;
      try {
        if (next) await this.register(); else await this.unregister();
        this.registered = next;
        this.availability(true);
      } catch {
        if (next) this.registrationFailed = this.desired;
        this.availability(false);
        // Registration failed: do not spin. The next session may retry.
        return;
      }
    }
  }
}
