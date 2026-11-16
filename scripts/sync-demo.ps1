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
$scripts = 'costmap', 'hazardviz', 'geo', 'structure', 'pathfinding', 'state', 'basemap', 'render2d', 'view3d', 'ui', 'app', 'detection', 'project'
foreach ($s in $scripts) {
  Copy-Item (Join-Path $Source "app\js\$s.js") (Join-Path $Demo "app\js\$s.js") -Force
}
Write-Host "projects/soc-map/demo/ 갱신 완료 <- $Source"

# 고정 초대 주소 (https://kimhoring.github.io/projects/soc-map/go/) — SOC-MAP v14.10
# 관리자 화면의 QR·초대 링크가 이 주소를 쓴다. 지금 켜져 있는 서버로 넘겨 주므로 노트북을 다시 켜도 같은 QR 을 쓴다
$GoDir = Join-Path $PSScriptRoot '..\projects\soc-map\go'
New-Item -ItemType Directory -Force $GoDir | Out-Null
Copy-Item (Join-Path $Source 'app\go.html') (Join-Path $GoDir 'index.html') -Force
Copy-Item (Join-Path $Source 'app\js\directory.js') (Join-Path $GoDir 'directory.js') -Force
Write-Host "projects/soc-map/go/ (고정 초대) 갱신 완료"

# 안드로이드 앱 받기 (고정 주소 https://kimhoring.github.io/projects/soc-map/app/) — SOC-MAP v14.7
# 같은 download.html 이 서버 없이(정적) 열리면 옆의 download/apps.json · icons/ 를 쓴다
$AppDir = Join-Path $PSScriptRoot '..\projects\soc-map\app'
$Apks = Join-Path $Source 'app\download'
if (Test-Path (Join-Path $Apks 'apps.json')) {
  New-Item -ItemType Directory -Force (Join-Path $AppDir 'download'), (Join-Path $AppDir 'icons') | Out-Null
  Copy-Item (Join-Path $Source 'app\download.html') (Join-Path $AppDir 'index.html') -Force
  Copy-Item (Join-Path $Apks 'apps.json') (Join-Path $AppDir 'download\apps.json') -Force
  Get-ChildItem $Apks -Filter '*.apk' | ForEach-Object { Copy-Item $_.FullName (Join-Path $AppDir "download\$($_.Name)") -Force }
  # SOC-MAP v14.14 화면 패치(앱 첫 화면 파일 + shell.json) — 휴대폰 앱이 다시 설치 없이 받아 바꾼다
  $Shell = Join-Path $Apks 'shell'
  if (Test-Path (Join-Path $Shell 'shell.json')) {
    $ShellOut = Join-Path $AppDir 'download\shell'
    if (Test-Path $ShellOut) { Remove-Item $ShellOut -Recurse -Force }
    New-Item -ItemType Directory -Force $ShellOut | Out-Null
    Get-ChildItem $Shell -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $ShellOut $_.Name) -Force }
  }
  foreach ($r in 'worker', 'supervisor') {
    Copy-Item (Join-Path $Source "app\pwa\icons\$r-192.png") (Join-Path $AppDir "icons\$r-192.png") -Force
  }
  Write-Host "projects/soc-map/app/ (앱 받기 · APK) 갱신 완료"
} else {
  Write-Host "APK 가 없어 앱 받기 페이지는 건너뜀 (android\APK_빌드.bat 으로 먼저 빌드)"
}
