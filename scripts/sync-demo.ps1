# SOC-MAP 앱 폴더에서 라이브 데모(projects/soc-map/demo/)를 다시 복사합니다.
# 사용: ./scripts/sync-demo.ps1 -Source "..\SOC-MAP v12"
param(
  [string]$Source = (Join-Path $PSScriptRoot '..\..\SOC-MAP v12')
)
$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path $Source).Path
$Demo = Join-Path $PSScriptRoot '..\projects\soc-map\demo'

if (-not (Test-Path (Join-Path $Source 'SOC_MAP.html'))) { throw "SOC_MAP.html 이 없습니다: $Source" }

New-Item -ItemType Directory -Force (Join-Path $Demo 'app\js') | Out-Null
Copy-Item (Join-Path $Source 'SOC_MAP.html') (Join-Path $Demo 'index.html') -Force
Copy-Item (Join-Path $Source 'app\style.css') (Join-Path $Demo 'app\style.css') -Force

# 관리자 화면이 쓰는 스크립트만 (현장 앱 field.js 는 서버가 필요해 제외)
$scripts = 'costmap', 'geo', 'pathfinding', 'state', 'basemap', 'render2d', 'view3d', 'ui', 'app', 'detection', 'project'
foreach ($s in $scripts) {
  Copy-Item (Join-Path $Source "app\js\$s.js") (Join-Path $Demo "app\js\$s.js") -Force
}
Write-Host "projects/soc-map/demo/ 갱신 완료 ← $Source"
