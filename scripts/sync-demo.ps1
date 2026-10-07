# SOC-MAP 앱 폴더에서 라이브 데모(projects/soc-map/demo/)를 다시 복사합니다.
# 사용: ./scripts/sync-demo.ps1   (기본값: AI\클로드\캡스톤\캡스톤 마무리\02_SOC-MAP_캡스톤\SOC-MAP)
#       ./scripts/sync-demo.ps1 -Source "다른\앱\폴더"
# 주의: 한글 경로가 들어 있으므로 이 파일은 "UTF-8 (BOM)" 으로 저장해야 Windows PowerShell 에서 동작합니다.
param(
  [string]$Source = ''
)
$ErrorActionPreference = 'Stop'
if (-not $Source) {
  $home_ = Split-Path $PSScriptRoot -Parent                     # ...\클로드\홈페이지
  $Source = Join-Path (Split-Path $home_ -Parent) '캡스톤\캡스톤 마무리\02_SOC-MAP_캡스톤\SOC-MAP'
  if (-not (Test-Path -LiteralPath $Source)) { throw "SOC-MAP 앱 폴더를 찾지 못했습니다: $Source`n-Source 로 경로를 지정하세요." }
}
$Source = (Resolve-Path -LiteralPath $Source).Path
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
Write-Host "projects/soc-map/demo/ 갱신 완료 <- $Source"
