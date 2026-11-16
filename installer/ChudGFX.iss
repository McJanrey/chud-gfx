; StandBy GFX installer. It installs over GFX Baby (same AppId and folder): the workspaces, fonts and
; run of show in C:\Chud GFX Baby stay and open in the new app. Uninstalling keeps them.
#ifndef AppVersion
  #define AppVersion "2.0.0"
#endif

[Setup]
AppId={{43214707-B19B-4A99-80D1-95904B763F12}
AppName=Chud GFX Baby
AppVersion={#AppVersion}
AppPublisher=StandBy Broadcast
DefaultDirName=C:\Chud GFX Baby
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=Output
OutputBaseFilename=Chud-GFX-Baby-Setup
SetupIconFile=..\web\placeholders\logo.ico
UninstallDisplayIcon={app}\ChudGFX.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Files]
Source: "..\dist\ChudGFX\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Chud GFX Baby"; Filename: "{app}\ChudGFX.exe"
Name: "{autodesktop}\Chud GFX Baby"; Filename: "{app}\ChudGFX.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"

[Run]
Filename: "{app}\ChudGFX.exe"; Description: "Open Chud GFX Baby"; Flags: nowait postinstall skipifsilent

[InstallDelete]
; GFX Baby's old program files (its libraries): the new ones replace them. Workspaces, library and settings stay.
Type: filesandordirs; Name: "{app}\_internal"
