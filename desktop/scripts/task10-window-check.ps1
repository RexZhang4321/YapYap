# Build/launch the disposable GUI input; focus it normally or with Computer Use,
# then create target/task10/start.txt. No UI input/focus automation in this script.
param([switch]$Live)
$ErrorActionPreference = 'Stop'
$task10DesktopRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$task10OutputRoot = Join-Path $task10DesktopRoot 'src-tauri/target/task10'
New-Item -ItemType Directory -Force $task10OutputRoot | Out-Null
$task10Source = Join-Path $PSScriptRoot 'task10-input.cs'
$task10Executable = Join-Path $task10OutputRoot 'task10-input.exe'
if (!(Test-Path -LiteralPath $task10Executable) -or (Get-Item -LiteralPath $task10Source).LastWriteTime -gt (Get-Item -LiteralPath $task10Executable).LastWriteTime) {
  Remove-Item -LiteralPath $task10Executable -ErrorAction SilentlyContinue
  Add-Type -TypeDefinition (Get-Content -LiteralPath $task10Source -Raw) -ReferencedAssemblies 'System.Windows.Forms.dll','System.Drawing.dll','System.dll','System.Core.dll' -OutputAssembly $task10Executable -OutputType WindowsApplication
}
$task10Arguments = @($task10DesktopRoot)
if ($Live) { $task10Arguments += 'live' }
$task10InputProcess = Start-Process -FilePath $task10Executable -ArgumentList $task10Arguments -WindowStyle Hidden -PassThru
$task10InputProcess.Id | Set-Content (Join-Path $task10OutputRoot 'input.pid')
$task10InputProcess.WaitForExit()
Get-Content -LiteralPath (Join-Path $task10OutputRoot 'window.json')
exit $task10InputProcess.ExitCode
