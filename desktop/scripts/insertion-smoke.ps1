# Run with: powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/insertion-smoke.ps1
# Requires the Tauri probe to be running. Does not change clipboard contents itself.
Add-Type -AssemblyName System.Windows.Forms
$clipboardBefore = [System.Windows.Forms.Clipboard]::GetText()
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KeyProbe {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@
$form = New-Object System.Windows.Forms.Form
$form.Text = 'YapYap insertion smoke target'
$form.Width = 550
$form.Height = 180
$inputBox = New-Object System.Windows.Forms.TextBox
$inputBox.Multiline = $true
$inputBox.Dock = 'Fill'
$form.Controls.Add($inputBox)
$script:events = New-Object System.Collections.Generic.List[string]
$inputBox.Add_KeyDown({ $script:events.Add(('KEY=' + $_.KeyData.ToString())) })
$form.Add_Deactivate({ $script:events.Add('DEACTIVATED') })
$sendTimer = New-Object System.Windows.Forms.Timer
$sendTimer.Interval = 500
$sendTimer.Add_Tick({
    $sendTimer.Stop()
    $form.Activate()
    $inputBox.Focus()
    [void][KeyProbe]::SetWindowPos($form.Handle, [IntPtr](-1), 0, 0, 0, 0, 3)
    [void][KeyProbe]::SetCursorPos(($form.Left + 100), ($form.Top + 80))
    [KeyProbe]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [KeyProbe]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    [void][KeyProbe]::SetForegroundWindow($form.Handle)
    $script:events.Add(('FOREGROUND=' + [KeyProbe]::GetForegroundWindow().ToString() + '; TARGET=' + $form.Handle.ToString()))
    [KeyProbe]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
    [KeyProbe]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [KeyProbe]::keybd_event(0x77, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 150
    [KeyProbe]::keybd_event(0x77, 0, 2, [UIntPtr]::Zero)
    [KeyProbe]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [KeyProbe]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
})
$doneTimer = New-Object System.Windows.Forms.Timer
$doneTimer.Interval = 3000
$doneTimer.Add_Tick({ $doneTimer.Stop(); $form.Close() })
$form.Add_Shown({ $inputBox.Focus(); $sendTimer.Start(); $doneTimer.Start() })
[void]$form.ShowDialog()
Write-Output ('TARGET_TEXT=' + $inputBox.Text)
Write-Output ('CLIPBOARD_TEXT_RESTORED=' + ($clipboardBefore -ceq [System.Windows.Forms.Clipboard]::GetText()))
Write-Output ($script:events -join ',')
