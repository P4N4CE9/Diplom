# Запуск магазина (сборка фронта + сервер)
$Root = $PSScriptRoot
$Python = Join-Path $Root ".." ".venv" "Scripts" "python.exe"
if (-not (Test-Path $Python)) {
    $Python = "python"
}

& $Python (Join-Path $Root "frontend" "build_frontend.py")
Set-Location (Join-Path $Root "backend")
& $Python run.py
