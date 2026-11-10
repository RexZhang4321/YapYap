# Windows native smoke run against the installed YapYap build.
#
# Launches the installed app with a synthetic WebView2 microphone and a local
# debugging port (process-local flags only), then runs windows-native-smoke.cs,
# which presses the real shortcut into its own target window and checks overlay
# focus/styles, HTTPS transcription and cleanup, guarded paste, rich clipboard
# restore, changed-destination refusal and retry, Esc cancel, hidden and
# minimized capture, insertion test mode and Download recording.
#
# -Live is required: each run sends a few seconds of synthetic speech to OpenAI
# with the saved key (two dictations). Keyboard, mouse focus and the clipboard
# are driven for about a minute; do not type during the run. Artifacts go to
# <repo>/tmp/windows-native-smoke. The app is restarted without test flags at
# the end if it was running before.
#
# Run with Windows PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-native-smoke.ps1 -Live [-StopRunningApp]
[CmdletBinding()]
param(
    [switch]$Live,
    [switch]$StopRunningApp,
    [string]$AppPath = (Join-Path $env:LOCALAPPDATA 'YapYap\yapyap.exe'),
    [int]$Port = 9333
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Run with Windows PowerShell (powershell.exe); the harness compiler needs it.' }
if (-not $Live) {
    Write-Output 'This run sends synthetic speech to OpenAI with the saved key. Re-run with -Live to authorize it.'
    exit 2
}
if (-not (Test-Path -LiteralPath $AppPath)) { throw "Installed app not found: $AppPath" }

$repoPath = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outputPath = Join-Path $repoPath 'tmp\windows-native-smoke'
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
Remove-Item -LiteralPath (Join-Path $outputPath 'results.json') -ErrorAction SilentlyContinue

# Fixed synthetic phrase with trailing silence; the fake device loops this file.
$speechPath = Join-Path $outputPath 'speech.wav'
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000,
        [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $speech.SetOutputToWaveFile($speechPath, $format)
    $prompt = New-Object System.Speech.Synthesis.PromptBuilder
    $prompt.AppendText('The meeting starts at three thirty. Please save the project tomorrow.')
    $prompt.AppendBreak([TimeSpan]::FromSeconds(1))
    $speech.Speak($prompt)
    $speech.SetOutputToNull()
} finally { $speech.Dispose() }

$harnessPath = Join-Path $outputPath 'windows-native-smoke.exe'
Remove-Item -LiteralPath $harnessPath -ErrorAction SilentlyContinue
Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-native-smoke.cs') -Raw -Encoding UTF8) `
    -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll' `
    -OutputAssembly $harnessPath -OutputType WindowsApplication

$running = @(Get-Process -Name yapyap -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $AppPath })
if ($running.Count -gt 0 -and -not $StopRunningApp) {
    throw 'YapYap is running. Quit it from the tray, or pass -StopRunningApp to stop it (unsaved dictations are lost).'
}
$wasRunning = $running.Count -gt 0
foreach ($process in $running) { Stop-Process -Id $process.Id -Force; $process.WaitForExit() }
Start-Sleep -Seconds 2  # let the previous WebView2 browser processes exit

$previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=`"$speechPath`" --remote-debugging-port=$Port"
try { $app = Start-Process -FilePath $AppPath -PassThru }
finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments }

$exitCode = 1
try {
    $deadline = (Get-Date).AddSeconds(30)
    $ready = $false
    while (-not $ready -and (Get-Date) -lt $deadline) {
        try {
            $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2
            $ready = @($targets | Where-Object { $_.type -eq 'page' -and $_.url -like '*/overlay.html' }).Count -gt 0
        } catch { }
        if (-not $ready) { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw 'The test app did not expose its debugging port.' }
    $harness = Start-Process -FilePath $harnessPath -ArgumentList @($Port, "`"$outputPath`"", $app.Id) -PassThru -Wait
    $exitCode = $harness.ExitCode
    $resultsPath = Join-Path $outputPath 'results.json'
    if (Test-Path -LiteralPath $resultsPath) {
        (Get-Content -LiteralPath $resultsPath -Raw | ConvertFrom-Json) | Format-List | Out-String -Width 200 | Write-Output
    } else { Write-Output 'The harness wrote no results.' }
} finally {
    Get-Process -Id $app.Id -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    if ($wasRunning) { Start-Process -FilePath $AppPath | Out-Null }  # normal launch, no test flags
}
if ($exitCode -eq 0) { Write-Output 'PASS: Windows native smoke run.' } else { Write-Output 'FAIL: see the results above.' }
exit $exitCode
