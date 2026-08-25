[CmdletBinding()]
param(
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$exitCode = 1

function Resolve-RovaiCommand {
  param([Parameter(Mandatory = $true)][string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $command) {
    throw "Required command was not found: $Name"
  }
  return $command.Source
}

function Invoke-RovaiPnpm {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & $script:pnpmExecutable @script:pnpmPrefix @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm failed with exit code $LASTEXITCODE"
  }
}

Push-Location $repositoryRoot
try {
  if (-not (Test-Path -LiteralPath 'package.json' -PathType Leaf)) {
    throw "The launcher is not inside a complete Rovai source directory: $repositoryRoot"
  }

  $nodeExecutable = Resolve-RovaiCommand 'node.exe'
  $nodeMajor = & $nodeExecutable -p "Number(process.versions.node.split('.')[0])"
  if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 24) {
    $nodeVersion = & $nodeExecutable --version
    throw "Node.js 24 or newer is required. Detected: $nodeVersion"
  }

  $pnpmCommand = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $pnpmCommand) {
    $script:pnpmExecutable = $pnpmCommand.Source
    $script:pnpmPrefix = @()
  } else {
    $script:pnpmExecutable = Resolve-RovaiCommand 'corepack.cmd'
    $script:pnpmPrefix = @('pnpm')
  }
  Invoke-RovaiPnpm '--version' | Out-Null
  [void](Resolve-RovaiCommand 'cargo.exe')

  $electronVite = Join-Path $repositoryRoot 'node_modules\electron-vite\bin\electron-vite.js'
  if (-not (Test-Path -LiteralPath $electronVite -PathType Leaf)) {
    if ($Check) {
      throw 'Project dependencies are not installed. Run start-rovai.cmd to install and start.'
    }
    Write-Host '[Rovai] First launch: installing locked dependencies...'
    Invoke-RovaiPnpm 'install' '--frozen-lockfile'
  }

  if ($Check) {
    Write-Host '[Rovai] Local launch check passed: Node.js, pnpm, Rust, and project dependencies are ready.'
    $exitCode = 0
  } else {
    Write-Host '[Rovai] Building and starting the local desktop app...'
    Write-Host '[Rovai] Keep this window open while the app is running.'
    Invoke-RovaiPnpm 'dev'
    $exitCode = 0
  }
} catch {
  Write-Host "[Rovai] $($_.Exception.Message)" -ForegroundColor Red
  $exitCode = 1
} finally {
  Pop-Location
}

exit $exitCode
