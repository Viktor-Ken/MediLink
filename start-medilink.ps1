# MediLink startup helper - brings up PostgreSQL + the API server in one go.
# Detects its own directory, so it works wherever the zip is extracted.
# Optional overrides: $env:PG_BIN, $env:PG_DATA, $env:MEDILINK_SERVER
$ErrorActionPreference = 'SilentlyContinue'

$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = $env:MEDILINK_SERVER; if (-not $server) { $server = Join-Path $root 'server' }
$pgbin  = $env:PG_BIN
$pgdata = $env:PG_DATA

# Locate PostgreSQL if not overridden
if (-not $pgbin) {
  $candidates = @()
  if (Test-Path 'C:\Postgres17\pgsql\bin\postgres.exe')      { $candidates += 'C:\Postgres17\pgsql\bin' }
  if (Test-Path 'C:\Program Files\PostgreSQL') {
    Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory | Sort-Object Name -Descending | ForEach-Object {
      if (Test-Path (Join-Path $_.FullName 'bin\postgres.exe')) { $candidates += (Join-Path $_.FullName 'bin') }
    }
  }
  $cmd = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += (Split-Path $cmd.Source) }
  $pgbin = $candidates | Select-Object -First 1
}
if (-not $pgdata -and $pgbin) {
  $pgparent = Split-Path $pgbin -Parent              # ...\pgsql or ...\17
  $gpparent = Split-Path $pgparent -Parent           # ...\Postgres17 or ...\PostgreSQL
  $cands = @((Join-Path $pgparent 'data'), (Join-Path $gpparent 'data'))
  $pgdata = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $pgdata) { $pgdata = $cands[0] }
}

# 1) PostgreSQL
if (-not $pgbin) {
  Write-Host 'PostgreSQL not found. Install it, then set PG_BIN and rerun this script.'
} else {
  $listening = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
  if (-not $listening) {
    Write-Host "Starting PostgreSQL ($pgbin)..."
    & "$pgbin\pg_ctl.exe" -D $pgdata -l (Join-Path $pgdata 'pg.log') start
    Start-Sleep -Seconds 3
  } else {
    Write-Host 'PostgreSQL already running on :5432'
  }
}

# 2) API server (cluster mode, port 4000)
$api = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
if (-not $api) {
  if (-not (Test-Path (Join-Path $server 'src\index.js'))) {
    Write-Host "Server not found at $server. Run 'npm install' in the server folder first." 
  } else {
    Write-Host 'Starting MediLink API on http://localhost:4000 ...'
    Start-Process -FilePath 'node' -ArgumentList 'src/index.js' -WorkingDirectory $server -WindowStyle Hidden
    Start-Sleep -Seconds 3
  }
} else {
  Write-Host 'MediLink API already running on :4000'
}

Write-Host ''
Write-Host 'Open:  http://localhost:4000  (admin/admin123)'