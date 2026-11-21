// Windows native smoke harness for the installed YapYap build. Started by
// windows-native-smoke.ps1, which launches the app with a synthetic WebView2
// microphone and a local debugging port. This program owns the target and decoy
// windows, presses the real configured shortcut, samples focus and overlay
// window styles, monitors CSP and runtime errors over CDP, and saves/restores
// user localStorage preferences. It prints fixed check names, booleans,
// timings, counts, and app status copy only: never transcripts, audio,
// clipboard contents, or credentials. C# 5 (Windows PowerShell Add-Type).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Win {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT pt);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern bool OpenClipboard(IntPtr hWndNewOwner);
  [DllImport("user32.dll")] public static extern bool CloseClipboard();
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);

  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

  public const int GWL_EXSTYLE = -20;
  public const long WS_EX_TOPMOST = 0x8, WS_EX_TRANSPARENT = 0x20, WS_EX_NOACTIVATE = 0x08000000;
  public const uint KEYUP = 2, WM_CLOSE = 0x10;
  public const uint MOD_ALT = 0x0001, MOD_CONTROL = 0x0002;

  public static uint Pid(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return pid; }
  public static IntPtr Window(uint pid, string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      // Check the owner first: reading titles of this harness's own windows sends messages to its UI thread.
      if (Pid(h) != pid) return true;
      var text = new StringBuilder(256); GetWindowTextW(h, text, 256);
      if (text.ToString() == title) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}

// Minimal synchronous Chrome DevTools Protocol client for Runtime.evaluate and error/CSP logging.
class Cdp {
  readonly ClientWebSocket socket = new ClientWebSocket();
  readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
  int sequence;
  public readonly List<string> Events = new List<string>();

  public static Cdp Connect(int port, Func<string, bool> matches) {
    var list = new JavaScriptSerializer().Deserialize<object[]>(new WebClient().DownloadString("http://127.0.0.1:" + port + "/json/list"));
    foreach (Dictionary<string, object> target in list) {
      if ((string)target["type"] == "page" && matches((string)target["url"])) {
        var cdp = new Cdp();
        cdp.socket.ConnectAsync(new Uri((string)target["webSocketDebuggerUrl"]), CancellationToken.None).Wait();
        return cdp;
      }
    }
    throw new Exception("WebView page not found; targets: " + string.Join(", ", list.Cast<Dictionary<string, object>>().Select(t => (string)t["url"])));
  }

  public void Call(string method, Dictionary<string, object> parameters) {
    int id = ++sequence;
    var request = new Dictionary<string, object> { { "id", id }, { "method", method } };
    if (parameters != null) request["params"] = parameters;
    var bytes = Encoding.UTF8.GetBytes(json.Serialize(request));
    socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None).Wait();
    while (true) {
      var message = json.Deserialize<Dictionary<string, object>>(Receive());
      if (message.ContainsKey("method")) { RecordEvent(message); continue; }
      if (!message.ContainsKey("id") || Convert.ToInt32(message["id"]) != id) continue;
      if (message.ContainsKey("error")) throw new Exception("CDP command failed: " + method);
      return;
    }
  }

  // Evaluates an expression (awaiting promises) and returns its JSON-decoded value.
  public object Eval(string expression) {
    int id = ++sequence;
    var request = new Dictionary<string, object> {
      { "id", id }, { "method", "Runtime.evaluate" },
      { "params", new Dictionary<string, object> {
        { "expression", "(async () => JSON.stringify(await (" + expression + ")))()" },
        { "awaitPromise", true }, { "returnByValue", true } } } };
    var bytes = Encoding.UTF8.GetBytes(json.Serialize(request));
    socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None).Wait();
    while (true) {
      var message = json.Deserialize<Dictionary<string, object>>(Receive());
      if (message.ContainsKey("method")) { RecordEvent(message); continue; }
      if (!message.ContainsKey("id") || Convert.ToInt32(message["id"]) != id) continue;
      if (message.ContainsKey("error")) throw new Exception("CDP command failed");
      var result = (Dictionary<string, object>)message["result"];
      if (result.ContainsKey("exceptionDetails")) throw new Exception("App-side expression failed: " + expression);
      var value = (Dictionary<string, object>)result["result"];
      return value.ContainsKey("value") && value["value"] != null ? json.DeserializeObject((string)value["value"]) : null;
    }
  }

  void RecordEvent(Dictionary<string, object> message) {
    var m = (string)message["method"];
    if (m == "Log.entryAdded" && message.ContainsKey("params")) {
      var p = (Dictionary<string, object>)message["params"];
      if (p.ContainsKey("entry")) {
        var entry = (Dictionary<string, object>)p["entry"];
        var level = entry.ContainsKey("level") ? (string)entry["level"] : "";
        var source = entry.ContainsKey("source") ? (string)entry["source"] : "";
        var text = entry.ContainsKey("text") ? (string)entry["text"] : "";
        if (level == "error" || source == "security" || text.IndexOf("Content Security Policy", StringComparison.OrdinalIgnoreCase) >= 0) {
          Events.Add("LOG[" + source + "/" + level + "]: " + text);
        }
      }
    } else if (m == "Runtime.exceptionThrown") {
      Events.Add("RUNTIME_EXCEPTION");
    } else if (m == "Runtime.consoleAPICalled" && message.ContainsKey("params")) {
      var p = (Dictionary<string, object>)message["params"];
      var type = p.ContainsKey("type") ? (string)p["type"] : "";
      if (type == "error") Events.Add("CONSOLE_ERROR");
    }
  }

  string Receive() {
    var buffer = new byte[65536];
    using (var stream = new MemoryStream())
    using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60))) {
      while (true) {
        var part = socket.ReceiveAsync(new ArraySegment<byte>(buffer), timeout.Token).Result;
        stream.Write(buffer, 0, part.Count);
        if (part.EndOfMessage) return Encoding.UTF8.GetString(stream.ToArray());
      }
    }
  }
}

class Smoke {
  const string Phrase = "meeting|project|tomorrow|three|3:30|save";
  const string InsertionTestText = "YapYap dictation insertion probe";
  readonly int port; readonly string output; readonly uint appPid; readonly string appPath;
  readonly List<KeyValuePair<string, object>> results = new List<KeyValuePair<string, object>>();
  Form target, decoy; TextBox targetBox, decoyBox;
  Cdp main, overlay;
  byte[] modifiers; byte key;
  int escapeKeyDowns;
  string rtfMarker;
  string savedPrefsRaw;
  bool hasSavedPrefs;
  volatile bool newerCopied;

  // Overlay sampler state (written by the sampler thread).
  volatile bool sampling = true;
  int overlaySamples, focusSteals, monitorMismatches, mainVisibleWhileHidden, samplerLoops, overlayFound;
  bool stylesNoActivate = true, stylesTopmost = true, stylesTransparent = true;
  volatile bool expectMainHidden;

  Smoke(int port, string output, uint appPid, string appPath) {
    this.port = port; this.output = output; this.appPid = appPid; this.appPath = appPath;
  }

  [STAThread]
  static int Main(string[] args) {
    var appPath = args.Length > 3 ? args[3] : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"YapYap\yapyap.exe");
    var smoke = new Smoke(int.Parse(args[0]), args[1], uint.Parse(args[2]), appPath);
    return smoke.Run();
  }

  int Run() {
    target = new Form { Text = "YapYap native smoke target", TopMost = true, StartPosition = FormStartPosition.Manual,
      Location = new Point(120, 120), Size = new Size(640, 260), KeyPreview = true };
    targetBox = new TextBox { Multiline = true, Dock = DockStyle.Fill };
    target.Controls.Add(targetBox);
    target.KeyDown += delegate(object s, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) Interlocked.Increment(ref escapeKeyDowns); };
    decoy = new Form { Text = "YapYap native smoke decoy", TopMost = true, StartPosition = FormStartPosition.Manual,
      Location = new Point(800, 120), Size = new Size(420, 200), ShowInTaskbar = false };
    decoyBox = new TextBox { Multiline = true, Dock = DockStyle.Fill };
    decoy.Controls.Add(decoyBox);
    int exit = 1;
    target.Shown += delegate {
      decoy.Show();
      var worker = new Thread(() => {
        try { exit = Steps() ? 0 : 1; }
        catch (Exception error) { Record("harnessError", error.GetType().Name + ": " + error.Message); exit = 1; }
        finally {
          sampling = false;
          RestoreUserPreferences();
          File.WriteAllText(Path.Combine(output, "results.json"), Json());
          target.BeginInvoke((Action)(() => { decoy.Close(); target.Close(); }));
        }
      });
      worker.IsBackground = true; worker.Start();
    };
    Application.Run(target);
    return exit;
  }

  void RestoreUserPreferences() {
    try {
      if (main != null && hasSavedPrefs) {
        if (savedPrefsRaw == null) S(main, "(localStorage.removeItem('com.jingxuan-zhang.yapyap/preferences'), true)");
        else {
          var escaped = new JavaScriptSerializer().Serialize(savedPrefsRaw);
          S(main, "(localStorage.setItem('com.jingxuan-zhang.yapyap/preferences', " + escaped + "), true)");
        }
      }
    } catch { }
  }

  // ---- Result bookkeeping ----
  void Record(string name, object value) { results.Add(new KeyValuePair<string, object>(name, value)); }
  bool Check(string name, bool ok) { Record(name, ok); return ok; }
  string Json() {
    var ordered = new Dictionary<string, object>();
    foreach (var item in results) ordered[item.Key] = item.Value;
    ordered["passed"] = results.Where(r => r.Value is bool).All(r => (bool)r.Value) && !ordered.ContainsKey("harnessError");
    return new JavaScriptSerializer().Serialize(ordered);
  }

  // ---- App state over CDP ----
  string S(Cdp page, string expression) { var value = page.Eval(expression); return value == null ? null : value.ToString(); }
  bool B(Cdp page, string expression) { var value = page.Eval(expression); return value is bool && (bool)value; }
  string State() { return S(main, "document.querySelector('#session-state').textContent"); }
  string OverlayPhase() { return S(overlay, "document.querySelector('#overlay').dataset.phase"); }
  string Field(string id) { return S(main, "(e => e ? (e.value ?? e.textContent) : null)(document.querySelector('#" + id + "'))"); }
  static bool WaitFor(Func<bool> condition, int milliseconds, int pollMs) {
    var deadline = DateTime.UtcNow.AddMilliseconds(milliseconds);
    while (DateTime.UtcNow < deadline) { if (condition()) return true; Thread.Sleep(pollMs); }
    return condition();
  }
  static bool WaitFor(Func<bool> condition, int milliseconds) { return WaitFor(condition, milliseconds, 100); }
  bool WaitAppIdle(int milliseconds) {
    return WaitFor(() => (Field("hold-state") ?? "") == "UP"
      && B(main, "!document.querySelector('#copy-text').disabled && !document.querySelector('#shortcut-record').disabled"), milliseconds);
  }
  bool WaitTargetCaptured(int milliseconds) {
    bool ok = WaitFor(() => (Field("hold-state") ?? "") == "DOWN"
      && (Field("insertion-status") ?? "").StartsWith("Capturing the focused target"), milliseconds, 25);
    if (ok) Thread.Sleep(150);
    return ok;
  }
  void SetSelect(string id, string value) {
    S(main, "(() => { const e = document.querySelector('#" + id + "');"
      + " Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, '" + value + "');"
      + " e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()");
  }
  void SetCheckbox(string id, bool checkedValue) {
    S(main, "(() => { const e = document.querySelector('#" + id + "');"
      + " if (e.checked !== " + (checkedValue ? "true" : "false") + ") e.click(); return e.checked; })()");
  }
  void Click(string id) { S(main, "(document.querySelector('#" + id + "').click(), true)"); }
  void InstallCspListener(Cdp page) {
    page.Call("Log.enable", null);
    page.Call("Runtime.enable", null);
    S(page, "(() => { window.__cspViolations = []; document.addEventListener('securitypolicyviolation', e => window.__cspViolations.push(e.violatedDirective + ':' + e.blockedURI)); return true; })()");
  }

  // ---- Windows input ----
  T Ui<T>(Func<T> action) { return (T)target.Invoke(action); }
  string TargetText() { return Ui(() => targetBox.Text.Replace("\r", "")); }
  string DecoyText() { return Ui(() => decoyBox.Text.Replace("\r", "")); }
  void ClearTexts() { Ui(() => { targetBox.Clear(); decoyBox.Clear(); return true; }); }

  bool Activate(Form form, TextBox box) {
    var handle = Ui(() => form.Handle);
    for (int attempt = 0; attempt < 6; attempt++) {
      Ui(() => {
        var fg = Win.GetForegroundWindow();
        uint unusedPid;
        uint fgThread = fg != IntPtr.Zero ? Win.GetWindowThreadProcessId(fg, out unusedPid) : 0;
        uint curThread = Win.GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != curThread && Win.AttachThreadInput(curThread, fgThread, true);
        try {
          form.TopMost = true;
          Win.ShowWindow(form.Handle, 9 /* SW_RESTORE */);
          Win.BringWindowToTop(form.Handle);
          Win.SetForegroundWindow(form.Handle);
          form.Activate();
          box.Focus();
        } finally {
          if (attached) Win.AttachThreadInput(curThread, fgThread, false);
        }
        return true;
      });
      Thread.Sleep(200);
      if (Win.GetForegroundWindow() != handle) {
        // Foreground lock fallback: a real click activates the window normally.
        var point = Ui(() => box.PointToScreen(new Point(box.Width / 2, box.Height / 2)));
        Win.SetCursorPos(point.X, point.Y);
        Win.mouse_event(2, 0, 0, 0, UIntPtr.Zero); Win.mouse_event(4, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(200);
      }
      if (Win.GetForegroundWindow() == handle && Ui(() => box.Focused)) return true;
    }
    return false;
  }

  void ParseShortcut(string shortcut) {
    var mods = new List<byte>();
    key = 0;
    foreach (var raw in shortcut.Split('+')) {
      var part = raw.Trim().ToLowerInvariant();
      if (part == "ctrl" || part == "control" || part == "commandorcontrol" || part == "cmdorctrl") mods.Add(0x11);
      else if (part == "alt" || part == "option") mods.Add(0x12);
      else if (part == "shift") mods.Add(0x10);
      else if (part == "super" || part == "win" || part == "meta") mods.Add(0x5B);
      else if (part.Length > 1 && part[0] == 'f' && part.Substring(1).All(char.IsDigit)) key = (byte)(0x6F + int.Parse(part.Substring(1)));
      else if (part == "space") key = 0x20;
      else if (part.Length == 1 && char.IsLetterOrDigit(part[0])) key = (byte)char.ToUpperInvariant(part[0]);
      else throw new Exception("Unsupported shortcut part: " + raw);
    }
    if (key == 0) throw new Exception("Shortcut has no key");
    modifiers = mods.ToArray();
  }
  void ShortcutDown() { foreach (var m in modifiers) Win.keybd_event(m, 0, 0, UIntPtr.Zero); Win.keybd_event(key, 0, 0, UIntPtr.Zero); }
  void ShortcutUp() { Win.keybd_event(key, 0, Win.KEYUP, UIntPtr.Zero); foreach (var m in modifiers.Reverse()) Win.keybd_event(m, 0, Win.KEYUP, UIntPtr.Zero); }
  void Escape() { Win.keybd_event(0x1B, 0, 0, UIntPtr.Zero); Thread.Sleep(40); Win.keybd_event(0x1B, 0, Win.KEYUP, UIntPtr.Zero); }

  void RecordShortcutViaUi(string shortcut) {
    bool ctrl = false, alt = false, shift = false, meta = false;
    string keyName = "", codeName = "";
    foreach (var raw in shortcut.Split('+')) {
      var p = raw.Trim();
      var low = p.ToLowerInvariant();
      if (low == "ctrl" || low == "control" || low == "commandorcontrol" || low == "cmdorctrl") ctrl = true;
      else if (low == "alt" || low == "option") alt = true;
      else if (low == "shift") shift = true;
      else if (low == "super" || low == "win" || low == "meta") meta = true;
      else if (low == "space") { keyName = " "; codeName = "Space"; }
      else if (p.Length == 1 && char.IsLetter(p[0])) { keyName = p.ToUpperInvariant(); codeName = "Key" + p.ToUpperInvariant(); }
      else if (p.Length == 1 && char.IsDigit(p[0])) { keyName = p; codeName = "Digit" + p; }
      else { keyName = p.ToUpperInvariant(); codeName = p.ToUpperInvariant(); }
    }
    // Wait for any in-flight native paste/restore operation to finish before recording.
    WaitFor(() => B(main, "!document.querySelector('#shortcut-record').disabled"), 5000);
    Click("shortcut-record");
    WaitFor(() => (Field("shortcut-record") ?? "") == "Cancel recording" && B(main, "!document.querySelector('#shortcut-record').disabled"), 5000);
    S(main, "(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: '" + keyName + "', code: '" + codeName
      + "', ctrlKey: " + (ctrl ? "true" : "false") + ", altKey: " + (alt ? "true" : "false")
      + ", shiftKey: " + (shift ? "true" : "false") + ", metaKey: " + (meta ? "true" : "false")
      + ", bubbles: true, cancelable: true })); return document.querySelector('#shortcut').value; })()");
    WaitFor(() => (Field("status") ?? "").Contains("Release your keys"), 3000);
    S(main, "(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: '" + keyName + "', code: '" + codeName
      + "', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, bubbles: true, cancelable: true })); return true; })()");
    // Wait until applyShortcut clears shortcutBusy and re-enables the button.
    WaitFor(() => (Field("shortcut-record") ?? "") == "Record shortcut" && B(main, "!document.querySelector('#shortcut-record').disabled"), 5000);
  }

  // ---- Clipboard (STA UI thread) ----
  void SetRichClipboard() {
    rtfMarker = "YapYapSmokeMarker" + Guid.NewGuid().ToString("N").Substring(0, 8);
    Ui(() => {
      var data = new DataObject();
      data.SetData(DataFormats.Rtf, @"{\rtf1\ansi {\b " + rtfMarker + @"}}");
      data.SetData(DataFormats.UnicodeText, rtfMarker);
      Clipboard.SetDataObject(data, true, 10, 50);
      return true;
    });
  }
  bool RichClipboardRestored() {
    return WaitFor(() => Ui(() => {
      try {
        var rtf = Clipboard.GetData(DataFormats.Rtf) as string;
        return rtf != null && rtf.Contains(rtfMarker) && rtf.Contains(@"\b") && Clipboard.GetText() == rtfMarker;
      } catch (ExternalException) { return false; }
    }), 4000);
  }
  void SetPlainClipboard(string text) {
    Ui(() => {
      for (int attempt = 0; attempt < 20; attempt++) {
        try { Clipboard.SetText(text); return true; }
        catch (ExternalException) { Thread.Sleep(25); }
      }
      Clipboard.SetText(text);
      return true;
    });
  }
  bool ClipboardTextEquals(string expected) {
    return WaitFor(() => Ui(() => {
      try { return Clipboard.ContainsText() && Clipboard.GetText() == expected; }
      catch (ExternalException) { return false; }
    }), 4000);
  }

  // ---- Overlay and window sampler ----
  void Sampler() {
    var overlayWindow = Win.Window(appPid, "YapYap " + (char)0x2014 + " Overlay");
    while (sampling) {
      Interlocked.Increment(ref samplerLoops);
      if (overlayWindow != IntPtr.Zero) Interlocked.Increment(ref overlayFound);
      if (overlayWindow != IntPtr.Zero && Win.IsWindowVisible(overlayWindow)) {
        Interlocked.Increment(ref overlaySamples);
        var foreground = Win.GetForegroundWindow();
        if (Win.Pid(foreground) == appPid) Interlocked.Increment(ref focusSteals);
        if (Win.MonitorFromWindow(overlayWindow, 2) != Win.MonitorFromWindow(foreground, 2)) Interlocked.Increment(ref monitorMismatches);
        long style = Win.GetWindowLongPtrW(overlayWindow, Win.GWL_EXSTYLE).ToInt64();
        stylesNoActivate &= (style & Win.WS_EX_NOACTIVATE) != 0;
        stylesTopmost &= (style & Win.WS_EX_TOPMOST) != 0;
        stylesTransparent &= (style & Win.WS_EX_TRANSPARENT) != 0;
      }
      if (expectMainHidden) {
        var mainWindow = Win.Window(appPid, "YapYap");
        if (mainWindow != IntPtr.Zero && Win.IsWindowVisible(mainWindow) && !Win.IsIconic(mainWindow)) Interlocked.Increment(ref mainVisibleWhileHidden);
      }
      Thread.Sleep(40);
    }
  }

  static bool HasSpeech(string text) {
    var lower = (text ?? "").ToLowerInvariant();
    return Phrase.Split('|').Any(word => lower.Contains(word));
  }

  // Holds the shortcut in the active target until recording (and optionally live words), then releases.
  bool Dictate(int holdMilliseconds, bool requireLiveWords, Action beforeRelease) {
    ShortcutDown();
    bool recording = WaitFor(() => State() == "recording" && OverlayPhase() == "recording", 10000);
    bool liveWords = true;
    if (requireLiveWords) {
      liveWords = recording && WaitFor(() => B(overlay, "document.querySelector('#overlay-text').textContent.length > 0"), holdMilliseconds);
    }
    Thread.Sleep(Math.Max(0, holdMilliseconds - 1500));
    if (beforeRelease != null) beforeRelease();
    ShortcutUp();
    return recording && liveWords;
  }

  bool Steps() {
    Directory.CreateDirectory(output);
    main = Cdp.Connect(port, url => !url.EndsWith("/overlay.html") && (url.StartsWith("http://tauri.localhost") || url.StartsWith("tauri://")));
    overlay = Cdp.Connect(port, url => url.EndsWith("/overlay.html"));
    InstallCspListener(main);
    InstallCspListener(overlay);

    if (!Check("appReady", WaitFor(() => S(main, "document.querySelector('#session-state') ? 'yes' : 'no'") == "yes", 20000))) return false;
    WaitFor(() => S(main, "document.querySelector('#dictation-status').textContent") != "", 10000);
    Record("startStatus", S(main, "document.querySelector('#dictation-status').textContent"));
    if (!Check("keySaved", WaitFor(() => S(main, "document.querySelector('#dictation-status').textContent") != "Setup needed", 10000))) return false;

    // Packaged CSP: AudioWorklet loads cleanly under script-src 'self'.
    Check("cspAudioWorkletLoads", B(main, "(async () => { const ctx = new AudioContext(); try { await ctx.audioWorklet.addModule(new URL('pcm-capture-worklet.js', window.location.href)); return true; } catch { return false; } finally { await ctx.close(); } })()"));

    // Snapshot user preferences so the run works with any saved toggles and restores them at exit.
    savedPrefsRaw = S(main, "localStorage.getItem('com.jingxuan-zhang.yapyap/preferences')");
    hasSavedPrefs = true;
    var prefs = string.IsNullOrEmpty(savedPrefsRaw)
      ? new Dictionary<string, object>()
      : new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(savedPrefsRaw);
    var originalShortcut = prefs.ContainsKey("shortcut") && !string.IsNullOrEmpty(prefs["shortcut"] as string) ? (string)prefs["shortcut"] : "Ctrl+Alt+F8";
    Record("userInitialShortcut", originalShortcut);
    SetCheckbox("full-audio-enabled", true);
    SetCheckbox("main-cleanup-enabled", true);
    SetCheckbox("live-enabled", true);
    SetSelect("microphone", "");
    ParseShortcut(originalShortcut);
    var labels = S(main, "navigator.mediaDevices.enumerateDevices().then(d => d.filter(x => x.kind === 'audioinput').map(x => x.label).join('|'))");
    Record("syntheticMicrophone", labels != null && labels.Split('|').Any(label => label.StartsWith("Fake")) ? (object)true : "labels unavailable until first capture");

    var sampler = new Thread(Sampler) { IsBackground = true }; sampler.Start();

    // 1. Settings cleanup and Shortcut test mode copy.
    Check("settingsNoOverlayFixture", B(main, "!document.querySelector('#probe-overlay-show') && !document.querySelector('#probe-overlay-hide')"));
    // #test-text shows the native insertion test string, which intentionally still says "probe".
    Check("settingsNoProbeWording", B(main, "(() => { const d = document.querySelector('#settings-dialog').cloneNode(true);"
      + " d.querySelector('#test-text')?.remove(); return !/probe/i.test(d.textContent); })()"));
    SetSelect("hotkey-action", "insert");
    Check("insertModeHint", WaitFor(() => Field("insertion-status") == "Ready. The target will be captured on key-down.", 3000));
    SetSelect("hotkey-action", "record");
    Check("recordModeHint", WaitFor(() => Field("insertion-status") == "Choose Text insertion test to check a destination.", 3000));

    // 2. Microphone-only capture, blob: WAV playback under CSP, and Download recording (no provider calls).
    SetSelect("hotkey-action", "capture");
    ClearTexts();
    if (!Check("captureTargetFocused", Activate(target, targetBox))) return false;
    Dictate(2500, false, null);
    Check("captureRecordingReady", WaitFor(() => State() == "ready", 10000) && TargetText() == "");
    bool playbackBlobOk = WaitFor(() => B(main, "(() => { const a = document.querySelector('#recording-playback'); return a && a.src && a.src.startsWith('blob:'); })()"), 5000);
    bool playbackPlayed = playbackBlobOk && B(main, "(async () => { const a = document.querySelector('#recording-playback'); a.muted = true; try { await a.play(); const ok = !a.paused && a.duration > 0; a.pause(); a.currentTime = 0; return ok; } catch { return false; } })()");
    Check("cspBlobAudioPlayback", playbackBlobOk && playbackPlayed);
    var paths = new List<string>();
    for (int i = 0; i < 2; i++) {
      WaitFor(() => B(main, "!document.querySelector('#download-recording').disabled"), 5000);
      Click("download-recording");
      string status = null;
      WaitFor(() => { status = Field("download-recording-status") ?? ""; return status.StartsWith("Saved recording to ") && !paths.Contains(status.Substring(19)); }, 10000);
      if (status != null && status.StartsWith("Saved recording to ")) paths.Add(status.Substring(19));
    }
    bool wavs = paths.Count == 2 && paths[0] != paths[1] && paths.All(p => {
      if (!File.Exists(p)) return false;
      var header = new byte[4];
      using (var file = File.OpenRead(p)) { if (file.Length <= 44) return false; file.Read(header, 0, 4); }
      return Encoding.ASCII.GetString(header) == "RIFF";
    });
    Check("downloadTwoDistinctWavs", wavs);
    foreach (var p in paths) if (File.Exists(p)) File.Delete(p);
    Click("discard-transcription");
    Check("captureDiscarded", WaitFor(() => State() == "discarded", 5000));

    // 3. Insertion test mode: key-down captures the target, release inserts the test text and restores RTF clipboard.
    SetSelect("hotkey-action", "insert");
    WaitAppIdle(5000);
    SetRichClipboard();
    ClearTexts();
    if (!Check("insertTestTargetFocused", Activate(target, targetBox))) return false;
    ShortcutDown();
    bool captured3 = WaitTargetCaptured(4000);
    ShortcutUp();
    Check("insertTestTextInserted", captured3 && WaitFor(() => TargetText() == InsertionTestText, 5000));
    Check("insertTestClipboardRestored", RichClipboardRestored());
    WaitAppIdle(5000);

    // 4. Insertion refusal variants (caret moved, pointer moved, closed target, held modifier).
    // 4a. Caret moved
    ClearTexts();
    Ui(() => { targetBox.Text = "hello world"; targetBox.SelectionStart = 11; targetBox.SelectionLength = 0; return true; });
    Activate(target, targetBox);
    ShortcutDown();
    bool captured4a = WaitTargetCaptured(4000);
    Ui(() => { targetBox.SelectionStart = 0; return true; });
    Thread.Sleep(80);
    ShortcutUp();
    Check("refusalCaretMoved", captured4a && WaitFor(() => (Field("insertion-status") ?? "").Contains("Text cursor moved"), 4000) && TargetText() == "hello world");
    WaitAppIdle(5000);

    // 4b. Pointer moved
    ClearTexts();
    Activate(target, targetBox);
    ShortcutDown();
    bool captured4b = WaitTargetCaptured(4000);
    Win.POINT pt; Win.GetCursorPos(out pt);
    Win.SetCursorPos(pt.X + 40, pt.Y + 40);
    Thread.Sleep(80);
    ShortcutUp();
    Check("refusalPointerMoved", captured4b && WaitFor(() => (Field("insertion-status") ?? "").Contains("Pointer moved"), 4000) && TargetText() == "");
    WaitAppIdle(5000);

    // 4c. Closed target
    Form tempForm = null; TextBox tempBox = null;
    Ui(() => {
      tempForm = new Form { Text = "YapYap temp close target", TopMost = true, StartPosition = FormStartPosition.Manual, Location = new Point(220, 220), Size = new Size(320, 140) };
      tempBox = new TextBox { Multiline = true, Dock = DockStyle.Fill };
      tempForm.Controls.Add(tempBox);
      tempForm.Show();
      return true;
    });
    Activate(tempForm, tempBox);
    ShortcutDown();
    bool captured4c = WaitTargetCaptured(4000);
    Ui(() => { tempForm.Close(); tempForm.Dispose(); return true; });
    Thread.Sleep(120);
    ShortcutUp();
    Check("refusalClosedTarget", captured4c && WaitFor(() => {
      var st = Field("insertion-status") ?? "";
      return st.Contains("Focused application or input changed") || st.Contains("No foreground window") || st.Contains("focused input could not be identified");
    }, 4000));
    WaitAppIdle(5000);

    // 4d. Held modifier (> 1.5 s)
    ClearTexts();
    Activate(target, targetBox);
    ShortcutDown();
    bool captured4d = WaitTargetCaptured(4000);
    // Hold Ctrl (0x11) down before releasing the shortcut so wait_for_modifiers times out for any shortcut.
    Win.keybd_event(0x11, 0, 0, UIntPtr.Zero);
    Win.keybd_event(key, 0, Win.KEYUP, UIntPtr.Zero);
    foreach (var m in modifiers.Reverse()) { if (m != 0x11) Win.keybd_event(m, 0, Win.KEYUP, UIntPtr.Zero); }
    Thread.Sleep(2200);
    Win.keybd_event(0x11, 0, Win.KEYUP, UIntPtr.Zero);
    Check("refusalHeldModifier", captured4d && WaitFor(() => (Field("insertion-status") ?? "").Contains("Modifier keys remained down"), 4000) && TargetText() == "");
    WaitAppIdle(5000);

    // 5. Clipboard edge cases: busy clipboard, newer-copy preservation, and explicit Copy/Restore/Replace.
    // 5a. Busy clipboard
    ClearTexts();
    Activate(target, targetBox);
    bool lockedClipboard = Ui(() => Win.OpenClipboard(target.Handle));
    try {
      ShortcutDown();
      bool captured5a = WaitTargetCaptured(4000);
      ShortcutUp();
      Check("clipboardBusyRefused", lockedClipboard && captured5a && WaitFor(() => (Field("insertion-status") ?? "").Contains("Clipboard is busy"), 5000) && TargetText() == "");
    } finally {
      if (lockedClipboard) Ui(() => Win.CloseClipboard());
    }
    WaitAppIdle(5000);

    // 5b. Newer-copy preservation
    ClearTexts();
    string olderMarker = "YapYapOlderMarker" + Guid.NewGuid().ToString("N").Substring(0, 8);
    string newerMarker = "YapYapNewerMarker" + Guid.NewGuid().ToString("N").Substring(0, 8);
    SetPlainClipboard(olderMarker);
    Activate(target, targetBox);
    newerCopied = false;
    string watcherDiag = "none";
    var shortcutUpAt = DateTime.UtcNow;
    // Copy the newer marker once the paste has landed in the target, inside the app's 250 ms
    // pre-restore window. Watch the target text, not the clipboard: polling the clipboard keeps it
    // open and makes the app's post-paste restore fail with "clipboard busy".
    // Suspected app issue: the sync Tauri insertion command sleeps 250 ms on the main thread, so taking clipboard
    // ownership (EmptyClipboard -> WM_DESTROYCLIPBOARD to the app window) blocks ~440 ms and collides with the
    // restore, leaving the backup pending. This check fails until the app stops blocking its main thread.
    var watcher = new Thread(() => {
      var dl = DateTime.UtcNow.AddSeconds(6);
      while (DateTime.UtcNow < dl) {
        if (TargetText() == InsertionTestText) {
          var seen = DateTime.UtcNow;
          for (int a = 0; a < 30; a++) {
            try {
              Ui(() => { Clipboard.SetText(newerMarker); return true; });
              newerCopied = true;
              watcherDiag = "seenAfterUpMs=" + (int)(seen - shortcutUpAt).TotalMilliseconds + " attempts=" + (a + 1) + " setMs=" + (int)(DateTime.UtcNow - seen).TotalMilliseconds;
              return;
            } catch (ExternalException) { Thread.Sleep(5); }
          }
          watcherDiag = "set failed after 30 attempts";
          return;
        }
        Thread.Sleep(5);
      }
    });
    watcher.IsBackground = true; watcher.Start();
    ShortcutDown();
    bool captured5b = WaitTargetCaptured(4000);
    shortcutUpAt = DateTime.UtcNow;
    ShortcutUp();
    watcher.Join(7000);
    WaitAppIdle(5000);
    bool preservedStatus = WaitFor(() => (Field("insertion-status") ?? "").Contains("newer clipboard contents were preserved"), 3000);
    if (!Check("clipboardNewerCopyPreserved", captured5b && newerCopied && ClipboardTextEquals(newerMarker) && preservedStatus))
      Record("clipboard5bDiag", "status=" + Field("insertion-status") + " | watcher " + watcherDiag);

    // 5c. Explicit Copy (with backup) -> Restore previous clipboard -> Copy without backup
    // Isolate 5c from an earlier step that left a clipboard backup pending.
    if (B(main, "!document.querySelector('#clipboard-recovery').hidden && !document.querySelector('#restore-clipboard').disabled")) {
      Record("clipboard5cClearedPendingBackup", true);
      Click("restore-clipboard");
      WaitFor(() => B(main, "document.querySelector('#restore-clipboard').disabled"), 5000);
    }
    SetRichClipboard();
    WaitAppIdle(5000);
    Click("copy-text");
    bool cText = ClipboardTextEquals(InsertionTestText);
    bool cUi = WaitFor(() => (Field("insertion-status") ?? "").StartsWith("Test text copied;")
      && B(main, "!document.querySelector('#clipboard-recovery').hidden && !document.querySelector('#restore-clipboard').disabled"), 4000);
    bool copiedWithBackup = Check("clipboardCopyWithBackup", cText && cUi);
    string diag5c = "copy(text=" + cText + ",ui=" + cUi + ",st=" + Field("insertion-status") + ")";
    Click("restore-clipboard");
    // Wait for native restoration plus the click handler's try/finally (status updated,
    // backup cleared so #restore-clipboard disables, and operationBusy cleared so #copy-without-backup re-enables).
    bool rClip = RichClipboardRestored();
    bool rUi = WaitFor(() => Field("insertion-status") == "Previous clipboard restored."
      && B(main, "document.querySelector('#restore-clipboard').disabled && !document.querySelector('#copy-without-backup').disabled"), 5000);
    bool restoredExplicit = Check("clipboardRestoreExplicit", rClip && rUi);
    diag5c += " | restore(clip=" + rClip + ",ui=" + rUi + ",st=" + Field("insertion-status") + ")";
    Click("copy-without-backup");
    bool wText = ClipboardTextEquals(InsertionTestText);
    bool wUi = WaitFor(() => (Field("insertion-status") ?? "").StartsWith("Test text copied without a backup"), 4000);
    bool copiedWithoutBackup = Check("clipboardCopyWithoutBackup", wText && wUi);
    diag5c += " | replace(text=" + wText + ",ui=" + wUi + ",st=" + Field("insertion-status") + ")";
    if (!(copiedWithBackup && restoredExplicit && copiedWithoutBackup)) Record("clipboard5cDiag", diag5c);
    WaitAppIdle(5000);

    // 6. Shortcuts: conflict keeps original, rebind works end-to-end, and original restores cleanly.
    // Pick the first free candidate shortcut so an unrelated desktop app cannot cause a false conflict failure.
    var altCandidates = new[] {
      Tuple.Create("Ctrl+Alt+F9", (uint)0x78, "F9"),
      Tuple.Create("Ctrl+Alt+F10", (uint)0x79, "F10"),
      Tuple.Create("Ctrl+Alt+F11", (uint)0x7A, "F11"),
      Tuple.Create("Ctrl+Alt+F7", (uint)0x76, "F7"),
    };
    string altShortcut = "Ctrl+Alt+F9"; string altCode = "F9";
    bool conflictRegistered = false;
    foreach (var candidate in altCandidates) {
      if (originalShortcut.Equals(candidate.Item1, StringComparison.OrdinalIgnoreCase)) continue;
      if (Ui(() => Win.RegisterHotKey(target.Handle, 9001, Win.MOD_CONTROL | Win.MOD_ALT, candidate.Item2))) {
        altShortcut = candidate.Item1; altCode = candidate.Item3; conflictRegistered = true; break;
      }
    }
    bool conflictRejected = false;
    bool originalStillWorksAfterConflict = false;
    string diag6 = "";
    try {
      Click("open-settings");
      WaitFor(() => B(main, "document.querySelector('#settings-dialog')?.open === true"), 3000);
      RecordShortcutViaUi(altShortcut);
      conflictRejected = WaitFor(() => {
        var st = (Field("status") ?? "").ToLowerInvariant();
        return st.Contains("conflict") || st.Contains("already") || st.Contains("in use") || st.Contains("could not") || st.Contains("unavailable") || st.Contains("kept");
      }, 5000);
      Record("shortcutConflictStatus", Field("status"));
      ClearTexts();
      Activate(target, targetBox);
      ShortcutDown();
      bool capturedOrig = WaitTargetCaptured(4000);
      ShortcutUp();
      originalStillWorksAfterConflict = capturedOrig && WaitFor(() => TargetText() == InsertionTestText, 4000);
      diag6 = "registered=" + conflictRegistered + " alt=" + altShortcut + " rejected=" + conflictRejected
        + " captured=" + capturedOrig + " hold=" + Field("hold-state") + " ins=" + Field("insertion-status")
        + " target=[" + TargetText() + "] settingsOpen=" + B(main, "document.querySelector('#settings-dialog')?.open === true");
      WaitAppIdle(5000);
    } finally {
      if (conflictRegistered) Ui(() => Win.UnregisterHotKey(target.Handle, 9001));
    }
    if (!Check("shortcutConflictKeepsOriginal", conflictRegistered && conflictRejected && originalStillWorksAfterConflict))
      Record("shortcutConflictDiag", diag6 == "" ? "registered=" + conflictRegistered + " rejected=" + conflictRejected : diag6);

    RecordShortcutViaUi(altShortcut);
    bool appliedAlt = WaitFor(() => (Field("shortcut-display") ?? "").Contains(altCode), 5000);
    ParseShortcut(altShortcut);
    ClearTexts();
    Activate(target, targetBox);
    ShortcutDown();
    bool capturedAlt = WaitTargetCaptured(4000);
    ShortcutUp();
    bool rebindWorked = appliedAlt && capturedAlt && WaitFor(() => TargetText() == InsertionTestText, 4000);
    Check("shortcutRebindWorks", rebindWorked);
    WaitAppIdle(5000);

    RecordShortcutViaUi(originalShortcut);
    bool restoredOriginal = WaitFor(() => (Field("shortcut-display") ?? "").Equals(originalShortcut, StringComparison.OrdinalIgnoreCase), 5000);
    ParseShortcut(originalShortcut);
    Check("shortcutRestoredOriginal", restoredOriginal);
    S(main, "(() => { const d = document.querySelector('#settings-dialog'); if (d && d.open) d.close(); return true; })()");
    WaitAppIdle(5000);

    // 7. Single-instance relaunch from tray and hidden-in-tray idle CPU check.
    SetSelect("hotkey-action", "record");
    WaitFor(() => Field("hotkey-action") == "record", 2000);
    var mainWindow = Win.Window(appPid, "YapYap");
    if (mainWindow != IntPtr.Zero && Win.IsWindowVisible(mainWindow)) Win.PostMessageW(mainWindow, Win.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    Check("mainWindowInTray", WaitFor(() => { var w = Win.Window(appPid, "YapYap"); return w == IntPtr.Zero || !Win.IsWindowVisible(w); }, 3000));

    var second = Process.Start(appPath);
    bool secondExited = second.WaitForExit(10000);
    int secondCode = secondExited ? second.ExitCode : -1;
    var yapyapProcs = Process.GetProcessesByName("yapyap");
    bool singleProc = yapyapProcs.Length == 1 && yapyapProcs[0].Id == (int)appPid;
    bool reopened = WaitFor(() => { var w = Win.Window(appPid, "YapYap"); return w != IntPtr.Zero && Win.IsWindowVisible(w); }, 5000);
    Check("singleInstanceReopensHiddenWindow", secondExited && secondCode == 0 && singleProc && reopened);

    // Hide back to tray, wait for idle, and sample idle CPU over 15 seconds.
    mainWindow = Win.Window(appPid, "YapYap");
    if (mainWindow != IntPtr.Zero && Win.IsWindowVisible(mainWindow)) Win.PostMessageW(mainWindow, Win.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    WaitFor(() => { var w = Win.Window(appPid, "YapYap"); return w == IntPtr.Zero || !Win.IsWindowVisible(w); }, 3000);
    WaitAppIdle(5000);
    Thread.Sleep(2000);
    var proc = Process.GetProcessById((int)appPid);
    var cpuBefore = proc.TotalProcessorTime;
    var sw = Stopwatch.StartNew();
    Thread.Sleep(15000);
    sw.Stop();
    proc.Refresh();
    var cpuDeltaMs = (proc.TotalProcessorTime - cpuBefore).TotalMilliseconds;
    var cpuPct = Math.Round((cpuDeltaMs / sw.Elapsed.TotalMilliseconds) * 100.0, 2);
    Record("hiddenMainProcessIdleCpu15sMs", Math.Round(cpuDeltaMs, 1));
    Record("hiddenMainProcessIdleCpu15sPct", cpuPct);
    Check("hiddenMainProcessIdleCpuLow", cpuPct < 2.0);

    // 8. Combined flow in tray: 3 consecutive dictations, timings, RTF restore, and retained results.
    expectMainHidden = true;
    int samplesBefore = overlaySamples;
    int consecutiveSuccess = 0;
    bool originalAndCleanedShown = false;
    for (int run = 1; run <= 3; run++) {
      WaitAppIdle(5000);
      SetRichClipboard();
      ClearTexts();
      if (!Activate(target, targetBox)) break;
      bool liveOk = Dictate(run == 1 ? 6500 : 5500, true, null);
      bool ins = WaitFor(() => State() == "inserted", 60000);
      bool hidden = WaitFor(() => OverlayPhase() == "hidden", 5000);
      WaitFor(() => TargetText().Trim().Length > 0, 3000);
      var pasted = TargetText().Trim();
      var cleaned = (Field("cleaned-transcript") ?? "").Replace("\r", "").Trim();
      var orig = (Field("transcript") ?? "").Replace("\r", "").Trim();
      if (orig.Length > 0 && cleaned.Length > 0) originalAndCleanedShown = true;
      bool exactOnce = ins && pasted.Length > 0 && (pasted == cleaned || pasted == orig) && HasSpeech(pasted);
      bool rtfOk = RichClipboardRestored();
      Record("trayRun" + run + "Timings", Field("processing-timings"));
      if (liveOk && ins && hidden && exactOnce && rtfOk) consecutiveSuccess++;
      else Record("trayRun" + run + "Diag", "live=" + liveOk + " ins=" + ins + " hidden=" + hidden + " exactOnce=" + exactOnce + " rtf=" + rtfOk
        + " state=" + State() + " alert=" + S(main, "document.querySelector('#dictation-alert-text')?.textContent || ''") + " target=[" + pasted + "]");
      WaitAppIdle(5000);
    }
    Check("combinedFlowThreeConsecutiveTrayPastes", consecutiveSuccess == 3);
    Check("trayOriginalAndCleanedShown", originalAndCleanedShown);
    int retainedCount = Convert.ToInt32(main.Eval("document.querySelectorAll('#retained-results > li').length"));
    Record("retainedResultsCount", retainedCount);
    Check("earlierResultsStayViewable", retainedCount >= 2);
    expectMainHidden = false;
    Check("trayMainWindowStayedHidden", mainVisibleWhileHidden == 0);
    Check("overlaySampledVisible", overlaySamples > samplesBefore);

    // 9. HTTPS success: cleanup-off and live-only (full-audio off) modes.
    WaitAppIdle(5000);
    SetCheckbox("main-cleanup-enabled", false);
    ClearTexts();
    Activate(target, targetBox);
    Dictate(4500, true, null);
    bool cleanupOffIns = WaitFor(() => State() == "inserted", 60000) && WaitFor(() => TargetText().Trim().Length > 0, 3000);
    var cleanupOffTimings = Field("processing-timings") ?? "";
    Record("cleanupOffTimings", cleanupOffTimings);
    Check("httpsCleanupOffInserted", cleanupOffIns && HasSpeech(TargetText()) && cleanupOffTimings.Contains("Cleanup requestSkipped"));
    WaitAppIdle(5000);

    SetCheckbox("full-audio-enabled", false);
    SetCheckbox("main-cleanup-enabled", true);
    ClearTexts();
    Activate(target, targetBox);
    Dictate(4500, true, null);
    bool liveOnlyIns = WaitFor(() => State() == "inserted", 60000) && WaitFor(() => TargetText().Trim().Length > 0, 3000);
    var liveOnlyTimings = Field("processing-timings") ?? "";
    Record("liveOnlyTimings", liveOnlyTimings);
    Check("httpsLiveOnlyInserted", liveOnlyIns && HasSpeech(TargetText()) && liveOnlyTimings.Contains("Transcription requestSkipped"));
    WaitAppIdle(5000);

    SetCheckbox("full-audio-enabled", true);
    SetCheckbox("main-cleanup-enabled", true);

    // 10. Changed destination with main window minimized: refuse, verify overlay error action, retry into target.
    if (mainWindow != IntPtr.Zero) Win.ShowWindow(mainWindow, 7 /* SW_SHOWMINNOACTIVE */);
    Check("mainWindowMinimized", mainWindow != IntPtr.Zero && WaitFor(() => Win.IsIconic(mainWindow), 3000));
    ClearTexts();
    if (!Check("refusalTargetFocused", Activate(target, targetBox))) return false;
    Check("minimizedLiveWordsBeforeRelease", Dictate(5000, true, () => Activate(decoy, decoyBox)));
    bool settled = WaitFor(() => { var s = State(); return s == "ready" || s == "failed" || s == "inserted"; }, 60000);
    WaitAppIdle(5000);
    bool overlayRefusalShown = WaitFor(() => OverlayPhase() == "error"
      && (S(overlay, "document.querySelector('#overlay-hint')?.textContent || ''") ?? "").Contains("Press "), 5000);
    Check("refusalNotInserted", settled && State() != "inserted" && TargetText() == "" && DecoyText() == "");
    Record("refusalAlert", S(main, "document.querySelector('#dictation-alert-text')?.textContent || ''"));
    Record("overlayRefusalPhase", OverlayPhase());
    Record("overlayRefusalHint", S(overlay, "document.querySelector('#overlay-hint')?.textContent || ''"));
    Check("overlayShowsPasteShortcutActionOnRefusal", overlayRefusalShown);
    var savedOutput = ((Field("cleaned-transcript") ?? "").Trim().Length > 0 ? Field("cleaned-transcript") : Field("transcript") ?? "").Replace("\r", "").Trim();
    if (!Check("retryTargetFocused", Activate(target, targetBox))) return false;
    var retryStarted = DateTime.UtcNow;
    ShortcutDown(); Thread.Sleep(300); ShortcutUp();
    Check("retryInsertedSavedOutput", WaitFor(() => State() == "inserted", 15000) && WaitFor(() => TargetText().Trim() == savedOutput && savedOutput.Length > 0, 3000));
    Record("retrySeconds", Math.Round((DateTime.UtcNow - retryStarted).TotalSeconds, 2));
    WaitAppIdle(5000);

    // 11. Esc during finishing cancels the dictation and never reaches the target.
    ClearTexts();
    if (!Check("escapeTargetFocused", Activate(target, targetBox))) return false;
    int escapesBefore = escapeKeyDowns;
    Dictate(3500, true, null);
    WaitFor(() => OverlayPhase() == "processing" || State() == "transcribing", 3000, 20);
    Escape();
    bool discarded = WaitFor(() => { var s = State(); return s == "discarded" || s == "inserted"; }, 8000) && State() == "discarded";
    WaitAppIdle(5000);
    Thread.Sleep(1500);
    Check("escapeCancelled", discarded && State() == "discarded" && TargetText() == "");
    Check("escapeOverlayHidden", WaitFor(() => OverlayPhase() == "hidden", 5000));
    Check("escapeNotDeliveredToTarget", escapeKeyDowns == escapesBefore);

    // 12. Overlay window behavior and zero CSP/CDP errors across all sessions.
    sampling = false; sampler.Join();
    Record("overlaySamples", overlaySamples);
    Record("samplerLoops", samplerLoops);
    Record("samplerOverlayFound", overlayFound);
    Check("overlayNeverTookFocus", focusSteals == 0);
    Check("overlayOnForegroundMonitor", monitorMismatches == 0);
    Check("overlayStyleNoActivate", overlaySamples > 0 && stylesNoActivate);
    Check("overlayStyleTopmost", overlaySamples > 0 && stylesTopmost);
    Check("overlayStyleClickThrough", overlaySamples > 0 && stylesTransparent);

    var mainCsp = S(main, "(window.__cspViolations || []).join('; ')");
    var overlayCsp = S(overlay, "(window.__cspViolations || []).join('; ')");
    Record("mainCspViolations", mainCsp);
    Record("overlayCspViolations", overlayCsp);
    Record("mainCdpErrorEvents", string.Join(" | ", main.Events));
    Record("overlayCdpErrorEvents", string.Join(" | ", overlay.Events));
    Check("zeroCspViolations", string.IsNullOrEmpty(mainCsp) && string.IsNullOrEmpty(overlayCsp));
    Check("zeroCdpErrorEvents", main.Events.Count == 0 && overlay.Events.Count == 0);
    return results.Where(r => r.Value is bool).All(r => (bool)r.Value);
  }
}
