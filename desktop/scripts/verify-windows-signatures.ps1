[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$InstalledExecutable
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$appPath = (Resolve-Path -LiteralPath $InstalledExecutable).Path
if ($installerPath -eq $appPath) { throw 'Installer and installed executable must be different files.' }
$setupSignature = Get-AuthenticodeSignature -LiteralPath $installerPath
$payloadSignature = Get-AuthenticodeSignature -LiteralPath $appPath
foreach ($signature in @($setupSignature, $payloadSignature)) {
    if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
        throw 'Both installer and installed application require valid, timestamped signatures.'
    }
}
if ($setupSignature.SignerCertificate.Thumbprint -ne $payloadSignature.SignerCertificate.Thumbprint) {
    throw 'Installer and installed application publishers differ.'
}
[ordered]@{
    installer = Split-Path -Leaf $installerPath
    installerSha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
    application = Split-Path -Leaf $appPath
    applicationSha256 = (Get-FileHash -LiteralPath $appPath -Algorithm SHA256).Hash
    publisher = $payloadSignature.SignerCertificate.Subject
    signerThumbprint = $payloadSignature.SignerCertificate.Thumbprint
    installerSignature = [string]$setupSignature.Status
    applicationSignature = [string]$payloadSignature.Status
    timestampsPresent = $true
} | ConvertTo-Json
