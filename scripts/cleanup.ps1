# Cleanup generated test artifacts
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root
$files = @('out_test.gif','ffmpeg_debug_test.mjs','test_welcome.js')
foreach ($f in $files) {
  if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue; Write-Host "Removed $f" }
}
# Remove temp banners in %TEMP% matching our prefix
Get-ChildItem -Path $env:TEMP -Filter "banner_out_*.gif" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $env:TEMP -Filter "banner_text_*.png" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Write-Host "Cleanup complete."
