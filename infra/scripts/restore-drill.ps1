$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Push-Location $repoRoot
try {
  $stamp = Get-Date -Format 'yyyyMMddHHmmss'
  $drillDb = "vertexlearn_restore_drill_$stamp"
  $dumpPath = Join-Path ([System.IO.Path]::GetTempPath()) "vertexlearn-dump-$stamp.sql"
  $composeArgs = @('--env-file', '.env', '-f', 'infra/docker-compose.yml')
  $sw = [Diagnostics.Stopwatch]::StartNew()

  try {
    docker compose @composeArgs exec -T postgres pg_dump -U vertexlearn -d vertexlearn -F p --no-owner --no-privileges |
      Set-Content -Path $dumpPath -Encoding UTF8

    if (-not (Test-Path $dumpPath) -or (Get-Item $dumpPath).Length -eq 0) {
      throw 'pg_dump produced an empty dump file.'
    }

    docker compose @composeArgs exec -T postgres psql -U vertexlearn -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $drillDb;" | Out-Null

    Get-Content -Raw -Path $dumpPath |
      docker compose @composeArgs exec -T postgres psql -U vertexlearn -d $drillDb -v ON_ERROR_STOP=1 -q | Out-Null

    $query = "SELECT (SELECT count(*) FROM users) || ',' || (SELECT count(*) FROM courses) || ',' || (SELECT count(*) FROM discussion_threads) || ',' || (SELECT count(*) FROM notifications) || ',' || (SELECT count(*) FROM outbox);"
    $sourceCounts = (docker compose @composeArgs exec -T postgres psql -U vertexlearn -d vertexlearn -t -A -c $query).Trim()
    $restoredCounts = (docker compose @composeArgs exec -T postgres psql -U vertexlearn -d $drillDb -t -A -c $query).Trim()

    if ($sourceCounts -ne $restoredCounts) {
      throw "Integrity mismatch after restore: source=[$sourceCounts] restored=[$restoredCounts]"
    }

    $sw.Stop()
    $rto = [Math]::Round($sw.Elapsed.TotalSeconds, 2)
    Write-Output "Restore drill passed in ${rto}s (counts: $restoredCounts)"
  }
  finally {
    docker compose @composeArgs exec -T postgres psql -U vertexlearn -d postgres -c "DROP DATABASE IF EXISTS $drillDb WITH (FORCE);" 2>$null | Out-Null
    if (Test-Path $dumpPath) {
      Remove-Item -Force $dumpPath
    }
  }
}
finally {
  Pop-Location
}

