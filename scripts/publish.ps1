<#
.SYNOPSIS
  Prepares the "publish" folder - a self-contained, offline package of the Gold Miner game.

.DESCRIPTION
  1. Builds the app (npm run build).
  2. Downloads the portable Node.js zip from nodejs.org and verifies its SHA256 (cached in .cache\node).
  3. Copies the files needed by "vite preview" and installs all modules (npm ci)
     using the downloaded Node.js.
  Copy the resulting folder to the target computer and run start.bat -
  nothing has to be installed there and no internet access is required.
#>
param(
  [int]$NodeMajor = 26,
  [string]$Arch = "win-x64",
  [string]$OutDir = "publish"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # speeds up Invoke-WebRequest in PS 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
$Publish = Join-Path $Root $OutDir

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }

function Invoke-Native([string]$Exe, [string[]]$Arguments, [string]$WorkDir = $Root) {
  Push-Location $WorkDir
  try {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command '$Exe $($Arguments -join ' ')' exited with code $LASTEXITCODE." }
  } finally { Pop-Location }
}

# Safety check: the publish folder must be inside the repository and must not be the repository itself.
$PublishFull = [IO.Path]::GetFullPath($Publish).TrimEnd('\')
if ($PublishFull -eq $Root.TrimEnd('\') -or -not $PublishFull.StartsWith($Root.TrimEnd('\') + '\')) {
  throw "Unsafe OutDir path: $PublishFull"
}

# --- 1. Build ---------------------------------------------------------------
Write-Step "Building the app"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js/npm is required on this computer to prepare the package."
}
if (-not (Test-Path (Join-Path $Root "node_modules\vite"))) {
  Invoke-Native "npm" @("ci", "--no-audit", "--no-fund")
}
Invoke-Native "npm" @("run", "build")

# --- 2. Portable Node.js -----------------------------------------------------
Write-Step "Downloading Node.js v$NodeMajor ($Arch)"
$DistUrl = "https://nodejs.org/dist/latest-v$NodeMajor.x"
$CacheDir = Join-Path $Root ".cache\node"
New-Item -ItemType Directory -Force $CacheDir | Out-Null

$ShaText = (Invoke-WebRequest -UseBasicParsing "$DistUrl/SHASUMS256.txt").Content
if ($ShaText -is [byte[]]) { $ShaText = [Text.Encoding]::ASCII.GetString($ShaText) }
$Pattern = "^([0-9a-f]{64})\s+(node-v$NodeMajor\.\d+\.\d+-$([regex]::Escape($Arch))\.zip)$"
$Match = $ShaText -split "`r?`n" | ForEach-Object { [regex]::Match($_.Trim(), $Pattern) } |
  Where-Object { $_.Success } | Select-Object -First 1
if (-not $Match) { throw "No $Arch archive found in $DistUrl/SHASUMS256.txt" }
$ExpectedHash = $Match.Groups[1].Value
$ZipName = $Match.Groups[2].Value
$ZipPath = Join-Path $CacheDir $ZipName

function Test-ZipHash { (Test-Path $ZipPath) -and ((Get-FileHash $ZipPath -Algorithm SHA256).Hash -ieq $ExpectedHash) }

if (Test-ZipHash) {
  Write-Host "Using previously downloaded $ZipName"
} else {
  Write-Host "Downloading $DistUrl/$ZipName"
  Invoke-WebRequest -UseBasicParsing "$DistUrl/$ZipName" -OutFile $ZipPath
  if (-not (Test-ZipHash)) {
    Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
    throw "SHA256 mismatch for downloaded $ZipName."
  }
}

# --- 3. Clean the publish folder (keeping logs) --------------------------------
Write-Step "Preparing the $OutDir folder"
$LogsBackup = $null
if (Test-Path (Join-Path $Publish "logs")) {
  $LogsBackup = Join-Path ([IO.Path]::GetTempPath()) ("goldminer-logs-" + [guid]::NewGuid())
  Write-Host "Keeping existing logs from $OutDir\logs" -ForegroundColor Yellow
  Move-Item (Join-Path $Publish "logs") $LogsBackup
}
if (Test-Path $Publish) { Remove-Item $Publish -Recurse -Force }
New-Item -ItemType Directory -Force $Publish | Out-Null
if ($LogsBackup) { Move-Item $LogsBackup (Join-Path $Publish "logs") }

# --- 4. Copy files ------------------------------------------------------------
Write-Step "Copying app files"
$Items = @(
  "dist",
  "api",
  "src\game\armEndpoints.js",
  "src\game\portalLaunch.js",
  "vite.config.js",
  "package.json",
  "package-lock.json",
  "start.bat",
  "portal_launch_test.html",
  "README.md",
  ".env.example"
)
foreach ($Item in $Items) {
  $Source = Join-Path $Root $Item
  if (-not (Test-Path $Source)) { throw "Missing required file: $Item" }
  $Target = Join-Path $Publish $Item
  New-Item -ItemType Directory -Force (Split-Path $Target -Parent) | Out-Null
  Copy-Item $Source $Target -Recurse -Force
}

Write-Step "Extracting Node.js to $OutDir\node"
$ExtractDir = Join-Path ([IO.Path]::GetTempPath()) ("goldminer-node-" + [guid]::NewGuid())
Expand-Archive $ZipPath -DestinationPath $ExtractDir
$Inner = Get-ChildItem $ExtractDir -Directory | Select-Object -First 1
Move-Item $Inner.FullName (Join-Path $Publish "node")
Remove-Item $ExtractDir -Recurse -Force

# --- 5. Install modules with the downloaded Node.js ---------------------------------
Write-Step "Installing modules (npm ci) in $OutDir"
$NodeDir = Join-Path $Publish "node"
$NodeExe = Join-Path $NodeDir "node.exe"
$NpmCli = Join-Path $NodeDir "node_modules\npm\bin\npm-cli.js"
$OldPath = $env:PATH
$env:PATH = "$NodeDir;$env:PATH"
try {
  Invoke-Native $NodeExe @($NpmCli, "ci", "--no-audit", "--no-fund") $Publish

  # --- 6. Smoke test ------------------------------------------------------------------
  Write-Step "Checking that modules load"
  Invoke-Native $NodeExe @("-e", "Promise.all([import('vite'),import('@vitejs/plugin-react'),import('@vercel/blob')]).then(([v])=>console.log('vite '+v.version+' OK')).catch(e=>{console.error(e);process.exit(1)})") $Publish
  $NodeVersion = & $NodeExe -v
} finally {
  $env:PATH = $OldPath
}

# --- 7. Summary ---------------------------------------------------------------
$SizeMb = [math]::Round(((Get-ChildItem $Publish -Recurse -File -Force | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host ""
Write-Host "Done: $PublishFull ($SizeMb MB, Node.js $NodeVersion)" -ForegroundColor Green
Write-Host "Copy the whole '$OutDir' folder to the target computer and run start.bat."
Write-Host "The .env file is not copied - if needed, create it from .env.example."
