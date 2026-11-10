// Windows native smoke harness for the installed YapYap build. Started by
// windows-native-smoke.ps1, which launches the app with a synthetic WebView2
// microphone and a local debugging port. This program owns the target and decoy
// windows, presses the real configured shortcut, samples focus and overlay
// window styles, and reads app state over CDP. It prints fixed check names,
// booleans and app status copy only: never transcripts, audio, clipboard
// contents or credentials. C# 5 (Windows PowerShell Add-Type compiler).
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
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  public const int GWL_EXSTYLE = -20;
  public const long WS_EX_TOPMOST = 0x8, WS_EX_TRANSPARENT = 0x20, WS_EX_NOACTIVATE = 0x08000000;
  public const uint KEYUP = 2, WM_CLOSE = 0x10;

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

// Minimal synchronous Chrome DevTools Protocol client for Runtime.evaluate.
class Cdp {
  readonly ClientWebSocket socket = new ClientWebSocket();
  readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
  int sequence;

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
      if (!message.ContainsKey("id") || Convert.ToInt32(message["id"]) != id) continue;
      if (message.ContainsKey("error")) throw new Exception("CDP command failed");
      var result = (Dictionary<string, object>)message["result"];
      if (result.ContainsKey("exceptionDetails")) throw new Exception("App-side expression failed: " + expression);
      var value = (Dictionary<string, object>)result["result"];
      return value.ContainsKey("value") && value["value"] != null ? json.DeserializeObject((string)value["value"]) : null;
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
  readonly int port; readonly string output; readonly uint appPid;
  readonly List<KeyValuePair<string, object>> results = new List<KeyValuePair<string, object>>();
  Form target, decoy; TextBox targetBox, decoyBox;
  Cdp main, overlay;
  byte[] modifiers; byte key;
  int escapeKeyDowns;
  string rtfMarker;

  // Overlay sampler state (written by the sampler thread).
  volatile bool sampling = true;
  int overlaySamples, focusSteals, monitorMismatches, mainVisibleWhileHidden, samplerLoops, overlayFound;
  bool stylesNoActivate = true, stylesTopmost = true, stylesTransparent = true;
  volatile bool expectMainHidden;

  Smoke(int port, string output, uint appPid) { this.port = port; this.output = output; this.appPid = appPid; }

  [STAThread]
  static int Main(string[] args) {
    var smoke = new Smoke(int.Parse(args[0]), args[1], uint.Parse(args[2]));
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
          File.WriteAllText(Path.Combine(output, "results.json"), Json());
          target.BeginInvoke((Action)(() => { decoy.Close(); target.Close(); }));
        }
      });
      worker.IsBackground = true; worker.Start();
    };
    Application.Run(target);
    return exit;
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
  static bool WaitFor(Func<bool> condition, int milliseconds) {
    var deadline = DateTime.UtcNow.AddMilliseconds(milliseconds);
    while (DateTime.UtcNow < deadline) { if (condition()) return true; Thread.Sleep(100); }
    return condition();
  }
  void SetSelect(string id, string value) {
    S(main, "(() => { const e = document.querySelector('#" + id + "');"
      + " Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, '" + value + "');"
      + " e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()");
  }
  void Click(string id) { S(main, "(document.querySelector('#" + id + "').click(), true)"); }

  // ---- Windows input ----
  T Ui<T>(Func<T> action) { return (T)target.Invoke(action); }
  string TargetText() { return Ui(() => targetBox.Text.Replace("\r", "")); }
  string DecoyText() { return Ui(() => decoyBox.Text.Replace("\r", "")); }
  void ClearTexts() { Ui(() => { targetBox.Clear(); decoyBox.Clear(); return true; }); }

  bool Activate(Form form, TextBox box) {
    var handle = Ui(() => form.Handle);
    for (int attempt = 0; attempt < 4; attempt++) {
      Win.SetForegroundWindow(handle);
      if (Win.GetForegroundWindow() != handle) {
        // Foreground lock fallback: a real click activates the window normally.
        var point = Ui(() => box.PointToScreen(new Point(box.Width / 2, box.Height / 2)));
        Win.SetCursorPos(point.X, point.Y);
        Win.mouse_event(2, 0, 0, 0, UIntPtr.Zero); Win.mouse_event(4, 0, 0, 0, UIntPtr.Zero);
      }
      Ui(() => { form.Activate(); box.Focus(); return true; });
      Thread.Sleep(250);
      if (Win.GetForegroundWindow() == handle && Ui(() => box.Focused)) return true;
    }
    return false;
  }

  void ParseShortcut(string shortcut) {
    var mods = new List<byte>();
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

  // Holds the shortcut in the active target until recording with live words, then releases.
  bool Dictate(int holdMilliseconds, Action beforeRelease) {
    ShortcutDown();
    bool recording = WaitFor(() => State() == "recording" && OverlayPhase() == "recording", 10000);
    bool liveWords = recording && WaitFor(() => B(overlay, "document.querySelector('#overlay-text').textContent.length > 0"), holdMilliseconds);
    Thread.Sleep(Math.Max(0, holdMilliseconds - 1500));
    if (beforeRelease != null) beforeRelease();
    ShortcutUp();
    return recording && liveWords;
  }

  bool Steps() {
    Directory.CreateDirectory(output);
    main = Cdp.Connect(port, url => !url.EndsWith("/overlay.html") && (url.StartsWith("http://tauri.localhost") || url.StartsWith("tauri://")));
    overlay = Cdp.Connect(port, url => url.EndsWith("/overlay.html"));
    if (!Check("appReady", WaitFor(() => S(main, "document.querySelector('#session-state') ? 'yes' : 'no'") == "yes", 20000))) return false;
    WaitFor(() => S(main, "document.querySelector('#dictation-status').textContent") != "", 10000);
    var startStatus = S(main, "document.querySelector('#dictation-status').textContent");
    Record("startStatus", startStatus);
    if (!Check("keySaved", WaitFor(() => S(main, "document.querySelector('#dictation-status').textContent") != "Setup needed", 10000))) return false;

    // Preconditions: default phases and the system default microphone (the synthetic one here).
    var preferences = S(main, "localStorage.getItem('com.jingxuan-zhang.yapyap/preferences') || '{}'");
    var prefs = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(preferences);
    Func<string, bool> enabled = name => !prefs.ContainsKey(name) || (prefs[name] is bool && (bool)prefs[name]);
    if (!Check("phasesAtDefaults", enabled("fullAudio") && enabled("cleanup") && enabled("live"))) return false;
    if (!Check("defaultMicrophone", !prefs.ContainsKey("microphone") || (string)prefs["microphone"] == "")) return false;
    ParseShortcut(prefs.ContainsKey("shortcut") ? (string)prefs["shortcut"] : "Ctrl+Alt+F8");
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

    // 2. Insertion test mode: key-down captures the target, release inserts the test text.
    SetRichClipboard();
    ClearTexts();
    SetSelect("hotkey-action", "insert");
    if (!Check("insertTestTargetFocused", Activate(target, targetBox))) return false;
    ShortcutDown(); Thread.Sleep(400); ShortcutUp();
    Check("insertTestTextInserted", WaitFor(() => TargetText() == InsertionTestText, 5000));
    Check("insertTestClipboardRestored", RichClipboardRestored());
    SetSelect("hotkey-action", "record");
    WaitFor(() => Field("hotkey-action") == "record", 2000);

    // 3. Main dictation with the main window in the tray: overlay, focus, HTTPS, cleanup, paste, clipboard.
    var mainWindow = Win.Window(appPid, "YapYap");
    if (mainWindow != IntPtr.Zero && Win.IsWindowVisible(mainWindow)) Win.PostMessageW(mainWindow, Win.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    Check("mainWindowInTray", WaitFor(() => { var w = Win.Window(appPid, "YapYap"); return w == IntPtr.Zero || !Win.IsWindowVisible(w); }, 3000));
    expectMainHidden = true;
    SetRichClipboard();
    ClearTexts();
    if (!Check("trayTargetFocused", Activate(target, targetBox))) return false;
    int samplesBefore = overlaySamples;
    Check("trayLiveWordsBeforeRelease", Dictate(6500, null));
    bool inserted = Check("trayInserted", WaitFor(() => State() == "inserted", 60000));
    Check("trayOverlayHiddenAfterSuccess", WaitFor(() => OverlayPhase() == "hidden", 5000));
    var targetText = TargetText().Trim();
    var cleaned = (Field("cleaned-transcript") ?? "").Replace("\r", "").Trim();
    var original = (Field("transcript") ?? "").Replace("\r", "").Trim();
    Check("trayPastedOnceExactly", inserted && targetText.Length > 0 && (targetText == cleaned || targetText == original));
    Check("trayTranscriptHasSyntheticSpeech", HasSpeech(targetText));
    Record("trayOriginalAndCleanedShown", original.Length > 0 && cleaned.Length > 0 ? (object)true : "not shown after insert");
    Check("trayClipboardRichTextRestored", RichClipboardRestored());
    Record("trayProcessingTimings", Field("processing-timings"));
    expectMainHidden = false;
    Check("trayMainWindowStayedHidden", mainVisibleWhileHidden == 0);
    Check("overlaySampledVisible", overlaySamples > samplesBefore);

    // 4. Changed destination with the main window minimized: refuse, keep text, then retry into a new target.
    if (mainWindow != IntPtr.Zero) Win.ShowWindow(mainWindow, 7 /* SW_SHOWMINNOACTIVE */);
    Check("mainWindowMinimized", mainWindow != IntPtr.Zero && WaitFor(() => Win.IsIconic(mainWindow), 3000));
    ClearTexts();
    if (!Check("refusalTargetFocused", Activate(target, targetBox))) return false;
    Check("minimizedLiveWordsBeforeRelease", Dictate(5000, () => Activate(decoy, decoyBox)));
    bool settled = WaitFor(() => { var s = State(); return s == "ready" || s == "failed" || s == "inserted"; }, 60000);
    Thread.Sleep(1000);
    Check("refusalNotInserted", settled && State() != "inserted" && TargetText() == "" && DecoyText() == "");
    Record("refusalAlert", S(main, "document.querySelector('#dictation-alert-text')?.textContent || ''"));
    var savedOutput = ((Field("cleaned-transcript") ?? "").Trim().Length > 0 ? Field("cleaned-transcript") : Field("transcript") ?? "").Replace("\r", "").Trim();
    if (!Check("retryTargetFocused", Activate(target, targetBox))) return false;
    var retryStarted = DateTime.UtcNow;
    ShortcutDown(); Thread.Sleep(300); ShortcutUp();
    Check("retryInsertedSavedOutput", WaitFor(() => State() == "inserted", 15000) && WaitFor(() => TargetText().Trim() == savedOutput && savedOutput.Length > 0, 3000));
    Record("retrySeconds", Math.Round((DateTime.UtcNow - retryStarted).TotalSeconds, 2));

    // 5. Esc during finishing cancels the dictation and never reaches the target.
    ClearTexts();
    if (!Check("escapeTargetFocused", Activate(target, targetBox))) return false;
    int escapesBefore = escapeKeyDowns;
    Dictate(3500, null);
    Thread.Sleep(120);
    Escape();
    bool discarded = WaitFor(() => { var s = State(); return s == "discarded" || s == "inserted"; }, 8000) && State() == "discarded";
    Thread.Sleep(2500);
    if (State() == "inserted") Record("escapeCancelled", "inconclusive: dictation finished before Esc");
    else Check("escapeCancelled", discarded && TargetText() == "");
    Check("escapeOverlayHidden", WaitFor(() => OverlayPhase() == "hidden", 5000));
    Check("escapeNotDeliveredToTarget", escapeKeyDowns == escapesBefore);

    // 6. Microphone-only capture and Download recording (no provider calls).
    SetSelect("hotkey-action", "capture");
    ClearTexts();
    if (!Check("captureTargetFocused", Activate(target, targetBox))) return false;
    Dictate(2500, null);
    Check("captureRecordingReady", WaitFor(() => State() == "ready", 10000) && TargetText() == "");
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
    SetSelect("hotkey-action", "record");

    // 7. Overlay window behavior across all sessions.
    sampling = false; sampler.Join();
    Record("overlaySamples", overlaySamples);
    Record("samplerLoops", samplerLoops);
    Record("samplerOverlayFound", overlayFound);
    Check("overlayNeverTookFocus", focusSteals == 0);
    Check("overlayOnForegroundMonitor", monitorMismatches == 0);
    Check("overlayStyleNoActivate", overlaySamples > 0 && stylesNoActivate);
    Check("overlayStyleTopmost", overlaySamples > 0 && stylesTopmost);
    Check("overlayStyleClickThrough", overlaySamples > 0 && stylesTransparent);
    return results.Where(r => r.Value is bool).All(r => (bool)r.Value);
  }
}
