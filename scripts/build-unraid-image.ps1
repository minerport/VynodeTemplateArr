param(
  [string]$Tag = 'vynode:serious-test',
  [string]$Archive = '',
  [ValidateSet('linux/amd64', 'linux/arm64')]
  [string]$Platform = 'linux/amd64'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
docker build --pull --platform $Platform --tag $Tag $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'Docker image build failed.' }

$imagePlatform = docker image inspect $Tag --format '{{.Os}}/{{.Architecture}}'
if ($LASTEXITCODE -ne 0 -or $imagePlatform.Trim() -ne $Platform) {
  throw "Built image platform '$imagePlatform' does not match requested '$Platform'."
}

if ($Archive) {
  $resolvedArchive = [IO.Path]::GetFullPath($Archive)
  $parent = Split-Path -Parent $resolvedArchive
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  docker save --output $resolvedArchive $Tag
  if ($LASTEXITCODE -ne 0) { throw 'Docker image export failed.' }
  $digest = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedArchive).Hash.ToLowerInvariant()
  $checksumPath = "$resolvedArchive.sha256"
  Set-Content -LiteralPath $checksumPath -Value "$digest  $([IO.Path]::GetFileName($resolvedArchive))" -Encoding ascii
  Write-Host "Image archive: $resolvedArchive"
  Write-Host "SHA-256: $checksumPath"
}

Write-Host "Built $Tag"
Write-Host "Platform: $imagePlatform"
Write-Host "Unraid template: $(Join-Path $projectRoot 'unraid\vynode.xml')"
