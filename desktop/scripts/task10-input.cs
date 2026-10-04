// Disposable native integration input. No keyboard/mouse/focus injection.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

class Task10Input {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] static extern IntPtr FindWindowW(string c, string t);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int command);
  static string Hash(string text) {
    using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", "").ToLowerInvariant();
  }
  static string Bool(bool value) { return value ? "true" : "false"; }
  [STAThread] static int Main(string[] args) {
    string root = args[0], output = Path.Combine(root, "src-tauri", "target", "task10");
    string trigger = Path.Combine(output, "start.txt"), phase = "", expectedHash = "";
    Directory.CreateDirectory(output);
    if (File.Exists(trigger)) File.Delete(trigger);
    var form = new Form { Text = "Task 10 disposable integration input", Width = 600, Height = 220 };
    var input = new TextBox { Multiline = true, Dock = DockStyle.Fill };
    form.Controls.Add(input);
    var timer = new Timer { Interval = 75 };
    Process child = null; int samples = 0, focusFailures = 0, recordingEdits = 0;
    bool initialFocus = false, timedOut = false; DateTime started = DateTime.Now;
    timer.Tick += delegate {
      if (child == null && File.Exists(trigger)) {
        initialFocus = GetForegroundWindow() == form.Handle && input.Focused;
        var info = new ProcessStartInfo("node.exe", "scripts/task10-webview-check.mjs check" + (args.Length > 1 ? " --live" : ""));
        info.WorkingDirectory = root; info.UseShellExecute = false; info.CreateNoWindow = true;
        info.RedirectStandardOutput = true; info.RedirectStandardError = true;
        child = new Process { StartInfo = info };
        child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) File.AppendAllText(Path.Combine(output, "check.json"), e.Data + Environment.NewLine); };
        child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) File.AppendAllText(Path.Combine(output, "check-error.txt"), e.Data + Environment.NewLine); };
        File.WriteAllText(Path.Combine(output, "check.json"), ""); File.WriteAllText(Path.Combine(output, "check-error.txt"), "");
        child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine(); started = DateTime.Now;
      }
      if (child == null) return;
      try {
        string json = File.ReadAllText(Path.Combine(output, "stage.json"));
        string nextPhase = Regex.Match(json, "\"phase\":\"([^\"]*)\"").Groups[1].Value;
        string nextHash = Regex.Match(json, "\"expectedHash\":\"([a-f0-9]{64})\"").Groups[1].Value;
        if (nextPhase.Length > 0 && nextHash.Length == 64) { phase = nextPhase; expectedHash = nextHash; }
      } catch (IOException) { }
      IntPtr overlay = FindWindowW(null, "BYOK Dictation \u2014 Overlay");
      if (overlay != IntPtr.Zero && IsWindowVisible(overlay)) {
        samples++; if (GetForegroundWindow() != form.Handle) focusFailures++;
      }
      if (phase == "recording" && Hash(input.Text) != expectedHash) recordingEdits++;
      if (child.HasExited) { timer.Stop(); form.Close(); }
      else if ((DateTime.Now - started).TotalSeconds > 150) { timedOut = true; child.Kill(); timer.Stop(); form.Close(); }
    };
    // The launcher hides its console/startup window. Explicitly display this
    // test surface without activating it; focus is established by normal input.
    form.Shown += delegate { ShowWindow(form.Handle, 4); timer.Start(); };
    Application.Run(form);
    if (child == null) return 1;
    child.WaitForExit();
    bool passed = child.ExitCode == 0 && !timedOut, preserved = samples > 0 && focusFailures == 0;
    bool unchanged = recordingEdits == 0, exact = phase == "done" && Hash(input.Text) == expectedHash;
    string result = "{\"testPassed\":" + Bool(passed) + ",\"observedVisibleSamples\":" + samples
      + ",\"initialInputFocusEstablished\":" + Bool(initialFocus) + ",\"focusPreserved\":" + Bool(preserved)
      + ",\"targetUnchangedBeforeRelease\":" + Bool(unchanged) + ",\"exactlyCanonicalInserted\":" + Bool(exact) + "}";
    File.WriteAllText(Path.Combine(output, "window.json"), result);
    timer.Dispose(); form.Dispose(); child.Dispose();
    return passed && initialFocus && preserved && unchanged && exact ? 0 : 1;
  }
}
