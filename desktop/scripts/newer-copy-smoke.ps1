# Run while the insertion probe is open. This replaces the clipboard with disposable test text.
# Focus a blank Notepad document and press Ctrl+Alt+F8 within 15 seconds of starting this script.
param([int]$WaitSeconds = 15)

Add-Type -AssemblyName System.Windows.Forms
$probeText = 'BYOK dictation insertion probe'
$olderText = 'BYOK older clipboard marker'
$newerText = 'BYOK newer clipboard marker'

[System.Windows.Forms.Clipboard]::SetText($olderText)
Write-Output 'Clipboard set to disposable older text. Focus a blank target and press Ctrl+Alt+F8 now.'

$deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
$sawProbeText = $false
while ([DateTime]::UtcNow -lt $deadline) {
    try {
        if ([System.Windows.Forms.Clipboard]::GetText() -ceq $probeText) {
            $sawProbeText = $true
            break
        }
    } catch [System.Runtime.InteropServices.ExternalException] {
        # The probe may briefly have the clipboard open.
    }
    Start-Sleep -Milliseconds 5
}

if (-not $sawProbeText) {
    Write-Error 'The temporary probe text was not observed; retry the check.'
    exit 1
}

$copied = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        [System.Windows.Forms.Clipboard]::SetText($newerText)
        $copied = $true
        break
    } catch [System.Runtime.InteropServices.ExternalException] {
        Start-Sleep -Milliseconds 5
    }
}

if (-not $copied) {
    Write-Error 'The clipboard stayed busy; retry the check.'
    exit 1
}

Start-Sleep -Milliseconds 400
$current = [System.Windows.Forms.Clipboard]::GetText()
if ($current -cne $newerText) {
    Write-Error "Newer clipboard copy was overwritten. Current text: $current"
    exit 1
}

Write-Output 'PASS: The newer clipboard copy was preserved.'
Write-Output 'The clipboard now contains the disposable newer marker.'
