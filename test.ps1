<#
  Smoke-tests index.html, planner.html, and factory.html in headless Chrome.

  Loads each page with ?autotest=1, which triggers a tiny permanent hook at
  the bottom of app.js/planner.js/loadout.js that pulls in test/smoke-calc.js,
  test/smoke-planner.js, or test/smoke-loadout.js. Those files run a handful
  of functional checks
  and print AUTOTEST:PASS/FAIL/ERROR lines to the console, which this
  script collects alongside any real Uncaught/SyntaxError/etc. and turns
  into a pass/fail report.

  Usage:
    .\test.ps1          # normal run, reuses dev server + Chrome profiles
    .\test.ps1 -Reset   # also wipes the Chrome test profiles first

  Exit code 0 = everything passed, 1 = something failed or the harness
  itself couldn't run (no Chrome found, dev server never came up, ...).
#>

param(
    [switch]$Reset
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$scratchRoot = "$env:TEMP\foxhole-test"
$logDir = "$scratchRoot\logs"
$port = 8000
$baseUrl = "http://localhost:$port"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromeExe = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chromeExe) {
    Write-Host "Chrome not found in any of the usual install locations - can't run smoke tests." -ForegroundColor Red
    exit 1
}

$pythonCmd = $null
if (Get-Command python -ErrorAction SilentlyContinue) { $pythonCmd = 'python' }
elseif (Get-Command python3 -ErrorAction SilentlyContinue) { $pythonCmd = 'python3' }

if ($Reset) {
    Write-Host "Resetting Chrome test profiles..."
    Remove-Item "$scratchRoot\profile-index" -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item "$scratchRoot\profile-planner" -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item "$scratchRoot\profile-factory" -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
}

function Test-ServerUp {
    try {
        $r = Invoke-WebRequest -Uri "$baseUrl/index.html" -UseBasicParsing -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

# Reuse whatever's already answering on the port instead of always paying
# for a fresh server start/stop — only spin one up (and only tear it back
# down afterward) if nothing was there to begin with.
$serverProc = $null
if (Test-ServerUp) {
    Write-Host "Reusing dev server already running on port $port."
} else {
    if (-not $pythonCmd) {
        Write-Host "No dev server running on port $port and python isn't on PATH - can't start one." -ForegroundColor Red
        exit 1
    }
    Write-Host "Starting dev server on port $port..."
    $serverProc = Start-Process -FilePath $pythonCmd -ArgumentList @('-m', 'http.server', "$port") -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
    $up = $false
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Milliseconds 200
        if (Test-ServerUp) { $up = $true; break }
    }
    if (-not $up) {
        Write-Host "Dev server never came up." -ForegroundColor Red
        if ($serverProc) { $serverProc | Stop-Process -Force -ErrorAction SilentlyContinue }
        exit 1
    }
}

function Start-PageTest {
    param([string]$PageName, [string]$ProfileDir)
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    $logFile = "$logDir\$PageName.log"
    Remove-Item $logFile -Force -Confirm:$false -ErrorAction SilentlyContinue
    $url = "$baseUrl/$PageName.html?autotest=1"
    # --incognito: a reused --user-data-dir speeds up launch (skips Chrome's
    # first-run setup) but would otherwise also reuse the HTTP cache between
    # runs — meaning a file edited without bumping its ?v= cache-buster (a
    # normal thing to do mid-iteration, before a change is finalized) could
    # silently test stale, pre-edit code. Incognito keeps the on-disk
    # profile shell but starts every run with a clean cache, so what's
    # tested always matches what's actually on disk.
    $proc = Start-Process -FilePath $chromeExe -ArgumentList @(
        '--headless=new',
        '--incognito',
        '--disable-gpu',
        '--no-sandbox',
        "--user-data-dir=$ProfileDir",
        '--virtual-time-budget=3000',
        '--enable-logging=stderr',
        '--v=1',
        $url
    ) -RedirectStandardError $logFile -PassThru -WindowStyle Hidden
    return [pscustomobject]@{ Name = $PageName; Proc = $proc; LogFile = $logFile }
}

# Kill any stray chrome.exe left over from a prior interrupted run before
# launching fresh ones, so nothing confuses the parallel Wait-Process below.
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# All pages launch together (no -Wait here) rather than one after another.
$jobs = @(
    (Start-PageTest -PageName 'index' -ProfileDir "$scratchRoot\profile-index"),
    (Start-PageTest -PageName 'planner' -ProfileDir "$scratchRoot\profile-planner"),
    (Start-PageTest -PageName 'factory' -ProfileDir "$scratchRoot\profile-factory")
)

$exitCode = 0
try {
    foreach ($job in $jobs) {
        Wait-Process -Id $job.Proc.Id -Timeout 15 -ErrorAction SilentlyContinue
        if (-not $job.Proc.HasExited) {
            Write-Host "$($job.Name): TIMED OUT after 15s, killing" -ForegroundColor Red
            $job.Proc | Stop-Process -Force -ErrorAction SilentlyContinue
            $exitCode = 1
        }
    }

    foreach ($job in $jobs) {
        Write-Host ""
        Write-Host "=== $($job.Name).html ===" -ForegroundColor Cyan
        $log = Get-Content $job.LogFile -Encoding UTF8 -ErrorAction SilentlyContinue
        $sawFail = $false

        foreach ($line in $log) {
            if ($line -match 'AUTOTEST:PASS ([^"]*)"') {
                Write-Host "  PASS  $($Matches[1])" -ForegroundColor Green
            } elseif ($line -match 'AUTOTEST:FAIL ([^"]*)"') {
                Write-Host "  FAIL  $($Matches[1])" -ForegroundColor Red
                $sawFail = $true
            } elseif ($line -match 'AUTOTEST:ERROR ([^"]*)"') {
                Write-Host "  ERROR $($Matches[1])" -ForegroundColor Red
                $sawFail = $true
            } elseif ($line -match '(Uncaught|SyntaxError|ReferenceError|TypeError)') {
                Write-Host "  JS ERROR  $line" -ForegroundColor Red
                $sawFail = $true
            }
        }

        if (-not ($log -match 'AUTOTEST:DONE')) {
            Write-Host "  FAIL  test never reached AUTOTEST:DONE (page may have failed to load)" -ForegroundColor Red
            $sawFail = $true
        }

        if ($sawFail) { $exitCode = 1 }
    }
} finally {
    foreach ($job in $jobs) { $job.Proc | Stop-Process -Force -ErrorAction SilentlyContinue }
    if ($serverProc) { $serverProc | Stop-Process -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
if ($exitCode -eq 0) { Write-Host "ALL CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "SOME CHECKS FAILED" -ForegroundColor Red }
exit $exitCode
