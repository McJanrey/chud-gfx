; Chud GFX installer (Inno Setup 6).
;
; Carries the app (the repo is private). Installs to C:\Chud GFX (no admin
; rights needed), adds a desktop shortcut, and keeps the settings and the
; graphics when run again over an existing install.
;
; Build:  ISCC.exe /DAppVersion=1.0.15 installer\Chud-GFX.iss
; (the GitHub Actions workflow does this for every release)

#ifndef AppVersion
  #define AppVersion "1.0"
#endif
#define AppName "Chud GFX"
#define Repo "McJanrey/chud-gfx"
#define ZipName "ChudGFX-windows.zip"

[Setup]
AppId={{43214707-B19B-4A99-80D1-95904B763F12}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName}
AppPublisher=St. Clair Saints
AppPublisherURL=https://github.com/{#Repo}
DefaultDirName=C:\Chud GFX
DisableDirPage=yes
DisableProgramGroupPage=yes
UsePreviousAppDir=no
; C:\ lets any user create a folder, so no administrator prompt is needed.
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Chud-GFX-Setup
SetupIconFile=..\packaging\icon.ico
UninstallDisplayIcon={app}\ChudGFX.exe
UninstallDisplayName={#AppName}
WizardStyle=modern
Compression=lzma2
SolidCompression=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Icons]
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\ChudGFX.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\ChudGFX.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\ChudGFX.exe"; WorkingDir: "{app}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[Files]
; The app is inside the installer (the repo is private, so it can't be downloaded while installing).
; workspaces\, library\ and settings.json are never in dist, so reinstalling keeps them.
Source: "..\dist\ChudGFX\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[UninstallDelete]
; Files the app makes itself. Graphics, fonts and settings are kept.
Type: filesandordirs; Name: "{app}\_update"
Type: files; Name: "{app}\smoke-test.txt"
