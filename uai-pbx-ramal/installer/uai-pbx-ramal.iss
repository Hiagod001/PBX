[Setup]
AppId={{7D55062A-9DC0-40FE-93E7-C20C4DF551F1}
AppName=UAI PBX Ramal
AppVersion=1.0.0
AppPublisher=UAI Telecom
DefaultDirName={localappdata}\Programs\UAI PBX Ramal
DefaultGroupName=UAI PBX Ramal
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=UAI-PBX-Ramal-Setup
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\UAI PBX Ramal.exe
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=lowest
WizardStyle=modern

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Area de Trabalho"; GroupDescription: "Atalhos:"; Flags: checkedonce

[Files]
Source: "..\dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\UAI PBX Ramal"; Filename: "{app}\UAI PBX Ramal.exe"; WorkingDir: "{app}"; IconFilename: "{app}\resources\assets\icon.ico"
Name: "{autodesktop}\UAI PBX Ramal"; Filename: "{app}\UAI PBX Ramal.exe"; WorkingDir: "{app}"; IconFilename: "{app}\resources\assets\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\UAI PBX Ramal.exe"; Description: "Abrir UAI PBX Ramal"; Flags: nowait postinstall skipifsilent
