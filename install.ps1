#requires -Version 5.1
<#
.SYNOPSIS
  Lab Agent CLI installer for Windows.

.EXAMPLE
  irm https://raw.githubusercontent.com/yu7dan/lab-agent/main/install.ps1 | iex

.EXAMPLE
  .\install.ps1 -FromSource

.NOTES
  Environment:
    LAB_AGENT_INSTALL_DIR  install root (default: %LOCALAPPDATA%\LabAgent)
    LAB_AGENT_VERSION      release tag (default: latest)
#>
param(
  [switch]$FromSource,
  [string]$Version = $(if ($env:LAB_AGENT_VERSION) { $env:LAB_AGENT_VERSION } else { 'latest' })
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'yu7dan/lab-agent'
$InstallDir = if ($env:LAB_AGENT_INSTALL_DIR) { $env:LAB_AGENT_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'LabAgent' }
$BinDir = Join-Path $InstallDir 'bin'

function Info($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "[+] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[x] $msg" -ForegroundColor Red; exit 1 }

function Download($url, $out) {
  Info "Downloading $(Split-Path $out -Leaf)"
  try {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
  } catch {
    throw "Download failed: $url`n$($_.Exception.Message)"
  }
}

function Verify-Checksum($file, $sumsPath) {
  if (-not (Test-Path $sumsPath)) {
    Warn 'No SHA256SUMS in release; skipping checksum.'
    return
  }
  $name = Split-Path $file -Leaf
  $line = Get-Content $sumsPath | Where-Object { $_ -match "\s$([regex]::Escape($name))$" } | Select-Object -First 1
  if (-not $line) {
    Warn "No checksum entry for $name; skipping."
    return
  }
  $expected = ($line -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash -Path $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) {
    Fail "Checksum mismatch for $name. Expected $expected, got $actual."
  }
  Ok 'Checksum verified'
}

function Install-Release {
  if (-not [Environment]::Is64BitOperatingSystem) {
    Fail 'Lab Agent currently ships a Windows x64 build only.'
  }
  $base = if ($Version -eq 'latest') {
    "https://github.com/$Repo/releases/latest/download"
  } else {
    "https://github.com/$Repo/releases/download/$Version"
  }

  $tmp = Join-Path $env:TEMP ("lab-agent-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    $zip = Join-Path $tmp 'lab-agent-windows-x64.zip'
    $sums = Join-Path $tmp 'SHA256SUMS'
    Download "$base/lab-agent-windows-x64.zip" $zip
    try { Download "$base/SHA256SUMS" $sums } catch { Warn 'SHA256SUMS not available.' }
    Verify-Checksum $zip $sums

    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
    Expand-Archive -Path $zip -DestinationPath $BinDir -Force
  } finally {
    Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }

  foreach ($f in @('lab.exe', 'lab-engine.exe')) {
    if (-not (Test-Path (Join-Path $BinDir $f))) { Fail "Archive is missing $f" }
  }
}

function Install-Source {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git is required for -FromSource.' }
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { Fail 'Bun is required for -FromSource: https://bun.sh' }

  $src = Join-Path $InstallDir 'src'
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  if (Test-Path (Join-Path $src '.git')) {
    Info 'Updating source'
    git -C $src pull --ff-only
  } else {
    Info "Cloning $Repo"
    git clone --depth 1 "https://github.com/$Repo.git" $src
  }

  Info 'Installing dependencies and building'
  Push-Location $src
  try {
    bun install
    if ($LASTEXITCODE -ne 0) { Fail 'bun install failed.' }
    bun run compile
    if ($LASTEXITCODE -ne 0) { Fail 'bun run compile failed.' }
  } finally {
    Pop-Location
  }

  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
  Copy-Item (Join-Path $src 'dist\lab.exe') (Join-Path $BinDir 'lab.exe') -Force
  Copy-Item (Join-Path $src 'dist\lab-engine.exe') (Join-Path $BinDir 'lab-engine.exe') -Force
}

function Add-ToUserPath {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @()
  if ($userPath) { $entries = $userPath -split ';' | Where-Object { $_ } }
  if ($entries -notcontains $BinDir) {
    $newPath = (@($entries) + $BinDir) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Ok "Added $BinDir to the user PATH (open a new terminal to use it)."
  }
  if (($env:Path -split ';') -notcontains $BinDir) {
    $env:Path = "$BinDir;$env:Path"
  }
}

Write-Host ''
Write-Host 'Lab Agent CLI installer' -ForegroundColor White
Write-Host ''

try {
  if ($FromSource) {
    Install-Source
  } else {
    try {
      Install-Release
    } catch {
      Warn 'No prebuilt CLI release is available; falling back to a source build.'
      Install-Source
    }
  }
} catch {
  Fail "Installation failed: $($_.Exception.Message)`nRe-run with -FromSource to build locally."
}

Add-ToUserPath

Write-Host ''
try {
  $ver = & (Join-Path $BinDir 'lab.exe') version
  Ok "Installed $ver"
} catch {
  Ok "Installed to $BinDir"
}
Write-Host ''
Write-Host 'Next:'
Write-Host '  lab setup     # configure a provider and API key'
Write-Host '  lab doctor    # verify the engine and connection'
Write-Host '  lab           # start coding'
Write-Host ''
