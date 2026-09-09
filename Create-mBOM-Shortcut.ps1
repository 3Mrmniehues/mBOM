# Creates "mBOM" shortcuts (Desktop + Start Menu) that launch the app with its
# own icon. The shortcut runs start-app.bat, which starts the local server (if
# it isn't already running) and opens the app in your browser.
#
# Run it by right-clicking this file -> "Run with PowerShell", or from a
# PowerShell prompt:  powershell -ExecutionPolicy Bypass -File .\Create-mBOM-Shortcut.ps1
#
# After it runs, right-click the new shortcut and choose "Pin to taskbar"
# (Windows 11: "Show more options" -> "Pin to taskbar").

$ErrorActionPreference = 'Stop'
$repo   = $PSScriptRoot
$target = Join-Path $repo 'start-app.bat'
$icon   = Join-Path $repo 'favicon.ico'

if (-not (Test-Path $target)) { throw "start-app.bat not found next to this script." }
if (-not (Test-Path $icon))   { throw "favicon.ico not found next to this script." }

$shell = New-Object -ComObject WScript.Shell
$locations = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
)

foreach ($dir in $locations) {
  $lnk = Join-Path $dir 'mBOM.lnk'
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath       = $target
  $s.WorkingDirectory = $repo
  $s.IconLocation     = "$icon,0"
  $s.WindowStyle      = 7   # minimized, to keep the launcher console out of the way
  $s.Description      = 'mBOM - Bill of Materials Manager'
  $s.Save()
  Write-Host "Created: $lnk  ->  $target"
}

Write-Host ''
Write-Host 'Done. Right-click the mBOM shortcut and choose "Pin to taskbar" to keep it there.'
