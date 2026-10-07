# A disposable native input for Task 9 overlay focus/no-edit verification.
# Run after task9-webview-check.mjs prepare, or prepare --live with -Live here.
param([switch]$Live)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Task9Window {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] public static extern IntPtr FindWindowW(string c, string t);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint data, UIntPtr extra);
  public static IntPtr Overlay() { return FindWindowW(null, "YapYap \u2014 Overlay"); }
}
'@
$task9DesktopRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$task9OutputRoot = Join-Path $task9DesktopRoot 'src-tauri/target/task9'
New-Item -ItemType Directory -Force $task9OutputRoot | Out-Null
$task9Form = New-Object System.Windows.Forms.Form
$task9Form.Text = 'Task 9 disposable overlay test input'
$task9Form.Width = 550
$task9Form.Height = 180
$task9Input = New-Object System.Windows.Forms.TextBox
$task9Input.Multiline = $true
$task9Input.Dock = 'Fill'
$task9Input.Text = 'Task 9 unchanged destination.'
$task9Form.Controls.Add($task9Input)
$task9CursorBefore = [System.Windows.Forms.Cursor]::Position
$task9Timer = New-Object System.Windows.Forms.Timer
$task9Timer.Interval = 75
$script:task9Child = $null
$script:task9Samples = 0
$script:task9FocusFailures = 0
$script:task9Timeout = $false
$script:task9Started = Get-Date
$task9Timer.Add_Tick({
  if ($null -eq $script:task9Child) {
    $task9Form.Activate()
    [void]$task9Input.Focus()
    $task9Point = $task9Input.PointToScreen((New-Object System.Drawing.Point(80, 50)))
    [void][Task9Window]::SetCursorPos($task9Point.X, $task9Point.Y)
    [Task9Window]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [Task9Window]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    [void][Task9Window]::SetForegroundWindow($task9Form.Handle)
    $script:task9InitialFocus = [Task9Window]::GetForegroundWindow() -eq $task9Form.Handle
    $task9Arguments = @('scripts/task9-webview-check.mjs', 'check')
    if ($Live) { $task9Arguments += '--live' }
    $script:task9Child = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList $task9Arguments -WorkingDirectory $task9DesktopRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $task9OutputRoot 'check.json') -RedirectStandardError (Join-Path $task9OutputRoot 'check-error.txt')
    [void]$script:task9Child.Handle
    $script:task9Started = Get-Date
  }
  $task9Overlay = [Task9Window]::Overlay()
  if ($task9Overlay -ne [IntPtr]::Zero -and [Task9Window]::IsWindowVisible($task9Overlay)) {
    $script:task9Samples++
    if ([Task9Window]::GetForegroundWindow() -ne $task9Form.Handle) { $script:task9FocusFailures++ }
  }
  if ($script:task9Child.HasExited) { $task9Timer.Stop(); $task9Form.Close() }
  elseif (((Get-Date) - $script:task9Started).TotalSeconds -gt 55) {
    $script:task9Timeout = $true
    Stop-Process -Id $script:task9Child.Id
    $task9Timer.Stop(); $task9Form.Close()
  }
})
$task9Form.Add_Shown({ $task9Timer.Start() })
try {
  [void]$task9Form.ShowDialog()
  $script:task9Child.WaitForExit()
  $task9Result = [ordered]@{
    testPassed = $script:task9Child.ExitCode -eq 0 -and !$script:task9Timeout
    observedVisibleSamples = $script:task9Samples
    overlayFound = [Task9Window]::Overlay() -ne [IntPtr]::Zero
    initialFocusEstablished = $script:task9InitialFocus
    focusPreserved = $script:task9Samples -gt 0 -and $script:task9FocusFailures -eq 0
    targetUnchanged = $task9Input.Text -ceq 'Task 9 unchanged destination.'
  }
  $task9Result | ConvertTo-Json -Compress
  if (!$task9Result.testPassed -or !$task9Result.focusPreserved -or !$task9Result.targetUnchanged) { exit 1 }
} finally {
  [void][Task9Window]::SetCursorPos($task9CursorBefore.X, $task9CursorBefore.Y)
  $task9Timer.Dispose(); $task9Form.Dispose()
}
