[CmdletBinding()]
param(
    [switch]$Signed,
    [string]$SigningConfig
)

$ErrorActionPreference = 'Stop'
# npm can inherit PowerShell 7's module search path while launching Windows
# PowerShell 5. Load this host's security module explicitly before verification.
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
Get-Command Get-AuthenticodeSignature, Get-FileHash -ErrorAction Stop | Out-Null
function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $Program) failed with exit code $LASTEXITCODE" }
}

$desktopPath = Split-Path -Parent $PSScriptRoot
$repoPath = Split-Path -Parent $desktopPath
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$previousTarget = $env:CARGO_TARGET_DIR
Push-Location $desktopPath
try {
    if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }
    if ($SigningConfig -and -not $Signed) { throw 'Use -Signed with -SigningConfig.' }
    if ($Signed -and -not $SigningConfig) { throw 'A signed release requires -SigningConfig.' }
    if ($Signed) {
        $SigningConfig = (Resolve-Path -LiteralPath $SigningConfig).Path
        $signing = Get-Content -LiteralPath $SigningConfig -Raw | ConvertFrom-Json
        if (-not $signing.bundle.windows.certificateThumbprint -and -not $signing.bundle.windows.signCommand) {
            throw 'Signing config must supply bundle.windows.certificateThumbprint or signCommand.'
        }
    }

    $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    $config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
    $cargoText = Get-Content -LiteralPath 'src-tauri/Cargo.toml' -Raw
    $cargoVersion = [regex]::Match($cargoText, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
    if ($package.version -ne $config.version -or $cargoVersion -ne $config.version) {
        throw 'package.json, Cargo.toml and tauri.conf.json versions must agree.'
    }

    $env:CARGO_TARGET_DIR = Join-Path $desktopPath 'src-tauri/target'
    $tempPath = Join-Path $env:CARGO_TARGET_DIR 'release-temp'
    New-Item -ItemType Directory -Force -Path $tempPath | Out-Null
    $env:TEMP = $tempPath
    $env:TMP = $tempPath

    Invoke-Checked 'npm.cmd' @('ci', '--cache', '.npm-cache', '--prefer-offline')
    Invoke-Checked 'npm.cmd' @('audit', '--audit-level=high', '--cache', '.npm-cache')
    Invoke-Checked 'npm.cmd' @('test')
    Invoke-Checked 'npm.cmd' @('run', 'test:ui')
    Push-Location 'src-tauri'
    try {
        Invoke-Checked 'cargo' @('fmt', '--check')
        Invoke-Checked 'cargo' @('test', '--lib', '--locked')
    } finally { Pop-Location }

    $started = [DateTime]::UtcNow
    $buildArgs = @('run', 'tauri', '--', 'build', '--ci', '--bundles', 'nsis')
    if ($Signed) { $buildArgs += @('--config', $SigningConfig) }
    else { $buildArgs += '--no-sign' }
    $buildArgs += @('--', '--locked')
    Invoke-Checked 'npm.cmd' $buildArgs

    $bundlePath = Join-Path $env:CARGO_TARGET_DIR 'release/bundle/nsis'
    $installers = @(Get-ChildItem -LiteralPath $bundlePath -Filter '*-setup.exe' |
        Where-Object { $_.LastWriteTimeUtc -ge $started })
    if ($installers.Count -ne 1) { throw 'Expected exactly one newly built NSIS installer.' }
    $executable = Join-Path $env:CARGO_TARGET_DIR 'release/desktop.exe'
    $appSignature = Get-AuthenticodeSignature -LiteralPath $executable
    $installerSignature = Get-AuthenticodeSignature -LiteralPath $installers[0].FullName
    if ($Signed) {
        # Tauri restores the unsigned/unpatched standalone executable after
        # embedding the signed NSIS payload. Verify the installed payload next.
        if ($installerSignature.Status -ne 'Valid' -or -not $installerSignature.TimeStamperCertificate) {
            throw 'Signed build requires a valid, timestamped installer signature.'
        }
    }

    Invoke-Checked 'python' @((Join-Path $PSScriptRoot 'test-audit-key-leaks.py'))
    Invoke-Checked 'python' @((Join-Path $PSScriptRoot 'audit-key-leaks.py'))
    $hash = Get-FileHash -LiteralPath $installers[0].FullName -Algorithm SHA256
    $revision = & git -C $repoPath rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot identify release Git revision.' }
    $changes = @(& git -C $repoPath status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot identify release working-tree status.' }
    $manifest = [ordered]@{
        version = $config.version
        builtAtUtc = [DateTime]::UtcNow.ToString('o')
        sourceCommit = $revision
        workingTreeDirty = ($changes.Count -gt 0)
        signed = [bool]$Signed
        standaloneApplicationSignature = [string]$appSignature.Status
        installedApplicationSignature = 'pending; run verify-windows-signatures.ps1 after installing this candidate'
        installerSignature = [string]$installerSignature.Status
        installer = $installers[0].Name
        bytes = $installers[0].Length
        sha256 = $hash.Hash
        manualAcceptance = 'pending; see scripts/task17-verification.md'
    }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundlePath 'release-manifest.json') -Encoding UTF8
    "$($hash.Hash)  $($installers[0].Name)" | Set-Content -LiteralPath (Join-Path $bundlePath 'SHA256SUMS.txt') -Encoding ASCII
    Write-Host "Installer: src-tauri/target/release/bundle/nsis/$($installers[0].Name)"
    if ($Signed) { Write-Host 'Install this candidate and run verify-windows-signatures.ps1 before external distribution.' }
    if (-not $Signed) { Write-Host 'Unsigned local test build. External distribution still requires signing and manual acceptance.' }
} finally {
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
    $env:CARGO_TARGET_DIR = $previousTarget
    Pop-Location
}
