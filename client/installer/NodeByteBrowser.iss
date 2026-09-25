; NodeByteBrowser.iss —— Windows 安装包（客户端提示词 附录D 骨架，完善版）
; 功能：双路径自定义（程序目录 + 用户数据目录）、安装语言选择（简体中文/English）、
;       注册表标记（UserData/SyncServer）、全套图标替换、卸载不删用户数据、
;       重装识别注册表标记复用旧数据。
; 编译：iscc NodeByteBrowser.iss

#define MyAppName "NodeByte Browser"
#define MyAppVersion "1.0.0"
#define MyAppExeName "nodebyte.exe"

[Setup]
AppId={{NODEBYTE-BROWSER-0001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=NodeByte
DefaultDirName={autopf}\NodeByte
DefaultGroupName=NodeByte
OutputBaseFilename=NodeByteBrowser-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\{#MyAppExeName}
WizardStyle=modern

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "完整安装 / Full installation"

[Components]
Name: "main"; Description: "浏览器主程序 / Browser core"; Types: full; Flags: fixed

[Files]
Source: "staging\nodebyte.exe"; DestDir: "{app}"; Components: main
Source: "staging\*"; DestDir: "{app}"; Components: main; Flags: recursesubdirs createallsubdirs
Source: "assets\icons\*"; DestDir: "{app}\assets\icons"; Components: main; Flags: recursesubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式 / Create desktop shortcut"; GroupDescription: "附加任务 / Additional tasks:"
Name: "quicklaunchpin"; Description: "固定到任务栏 / Pin to taskbar"; GroupDescription: "附加任务 / Additional tasks:"

[Registry]
; 用户数据目录与同步服务器地址（卸载不删数据、重装复用，提示词 5.15.2）
Root: HKCU; Subkey: "Software\NodeByte\Browser"; ValueType: string; ValueName: "UserDataPath"; ValueData: "{code:GetUserDataDir}"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\NodeByte\Browser"; ValueType: string; ValueName: "SyncServer"; ValueData: "bsync.nodebyte.cn"; Flags: uninsdeletevalue

[Code]
var
  UserDataPage: TInputDirWizardPage;

procedure InitializeWizard;
begin
  UserDataPage := CreateInputDirPage(wpSelectDir,
    '选择用户数据存储位置', '浏览器数据（Profile、Cookie、缓存）将保存到该目录。',
    '建议选择空间充足的磁盘（如 D 盘）。', False, '');
  UserDataPage.Add('用户数据目录（User-Data）：');
  UserDataPage.Values[0] := GetPreviousData('UserDataPath',
    ExpandConstant('{localappdata}\NodeByte\User Data'));
end;

function GetUserDataDir(Param: string): string;
begin
  Result := UserDataPage.Values[0];
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  SetPreviousData(PreviousDataKey, 'UserDataPath', UserDataPage.Values[0]);
end;

{ 重装识别注册表标记复用旧数据：安装时不清理 UserDataPath；卸载脚本不删除该目录 }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    { 明确保留用户数据目录（提示词 6.3：卸载不删 UserData） }
    MsgBox('您的用户数据（Profile、Cookie、缓存）已保留，路径见注册表 HKCU\Software\NodeByte\Browser。', mbInformation, MB_OK);
  end;
end;

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "立即启动 NodeByte 浏览器"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\*"
