# Local, synthetic fixture only. Run with Windows PowerShell (System.Speech).
# Never use this utility to persist a real microphone recording.
param([string]$OutputPath = (Join-Path $PSScriptRoot '../src-tauri/target/task6/speech.wav'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$fixturePath = [IO.Path]::GetFullPath($OutputPath)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($fixturePath)) | Out-Null
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
        16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
        [System.Speech.AudioFormat.AudioChannel]::Mono)
    $speech.SetOutputToWaveFile($fixturePath, $format)
    $speech.Speak('Hello from the dictation test. The meeting starts at three thirty. Please save the project tomorrow.')
    $speech.SetOutputToNull()
} finally { $speech.Dispose() }
Write-Output "Synthetic speech fixture created: $fixturePath"
