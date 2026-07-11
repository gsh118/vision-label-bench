param(
    [string]$HostAddress = "127.0.0.1",
    [int]$Port = 8010
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDist = Join-Path $Root "frontend\dist\index.html"

if (-not (Test-Path $FrontendDist)) {
    throw "frontend/dist가 없습니다. 먼저 frontend 폴더에서 npm install과 npm run build를 실행하세요."
}

Set-Location $Root
$Executable = Join-Path $Root ".venv\Scripts\lb-tool.exe"
if (-not (Test-Path $Executable)) {
    throw ".venv가 없습니다. 먼저 uv sync --extra yolo를 실행하세요."
}
& $Executable --host $HostAddress --port $Port
