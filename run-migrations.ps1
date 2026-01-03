# Run Database Migrations
# This script executes all SQL files in the Database folder in order

param(
    [string]$ConnectionString = ""
)

if ([string]::IsNullOrEmpty($ConnectionString)) {
    Write-Host "Usage: .\run-migrations.ps1 -ConnectionString 'your-connection-string'"
    Write-Host ""
    Write-Host "Example:"
    Write-Host ".\run-migrations.ps1 -ConnectionString 'Host=localhost;Database=mydb;Username=postgres;Password=mypassword'"
    exit 1
}

# Get all SQL files in the Database folder, sorted by name
$sqlFiles = Get-ChildItem -Path ".\Media.JoshHeaps.Net\Database\*.sql" | Sort-Object Name

if ($sqlFiles.Count -eq 0) {
    Write-Host "No SQL migration files found in .\Media.JoshHeaps.Net\Database\"
    exit 1
}

Write-Host "Found $($sqlFiles.Count) migration files to execute:"
$sqlFiles | ForEach-Object { Write-Host "  - $($_.Name)" }
Write-Host ""

# Check if psql is available
$psqlPath = Get-Command psql -ErrorAction SilentlyContinue

if (-not $psqlPath) {
    Write-Host "ERROR: psql command not found. Please install PostgreSQL client tools."
    Write-Host ""
    Write-Host "Alternatively, you can manually run each SQL file using your preferred PostgreSQL client:"
    $sqlFiles | ForEach-Object {
        Write-Host "  psql `"$ConnectionString`" -f `"$($_.FullName)`""
    }
    exit 1
}

# Execute each migration
$successCount = 0
$failCount = 0

foreach ($file in $sqlFiles) {
    Write-Host "Executing: $($file.Name)... " -NoNewline

    try {
        $result = psql $ConnectionString -f $file.FullName 2>&1

        if ($LASTEXITCODE -eq 0) {
            Write-Host "SUCCESS" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host "FAILED" -ForegroundColor Red
            Write-Host "  Error: $result"
            $failCount++
        }
    } catch {
        Write-Host "FAILED" -ForegroundColor Red
        Write-Host "  Error: $($_.Exception.Message)"
        $failCount++
    }
}

Write-Host ""
Write-Host "Migration Summary:"
Write-Host "  Successful: $successCount" -ForegroundColor Green
Write-Host "  Failed: $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })

if ($failCount -gt 0) {
    exit 1
}
