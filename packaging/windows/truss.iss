#ifndef SourceDir
#define SourceDir "..\..\dist\windows\Truss"
#endif

#ifndef AppVersion
#define AppVersion "0.1.0"
#endif

[Setup]
AppId={{4FB312EE-0197-4C17-8C65-186359B9B894}
AppName=Truss
AppVersion={#AppVersion}
AppPublisher=Truss
DefaultDirName={autopf}\Truss
DefaultGroupName=Truss
DisableProgramGroupPage=yes
OutputDir=..\..\dist\windows
OutputBaseFilename=truss-setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
SetupIconFile={#SourceDir}\truss.ico
WizardImageFile={#SourceDir}\truss-wizard.bmp
WizardSmallImageFile={#SourceDir}\truss-wizard-small.bmp
UninstallDisplayIcon={app}\truss.ico

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Truss"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\open-truss.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\truss.ico"
Name: "{group}\Truss Tray"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\truss-tray.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\truss.ico"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-truss.ps1"" -InstallDir ""{app}"" -SkipFileCopy"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-truss.ps1"" -InstallDir ""{app}"" -KeepFiles"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated
