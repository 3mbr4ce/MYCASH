; MYCASH - per-user Windows x64 installer (NSIS 3.x, Unicode). Adapted from MYYT's installer.
; Build:  makensis -DVERSION=0.0.1 installer/MYCASH.nsi   (or installer/build-installer.sh)
; Installs to %LOCALAPPDATA%\Programs\MYCASH without admin rights.
; User data (%LOCALAPPDATA%\MYCASH: data\data.json, data\sync.json with paired devices, WebView2 profile) is never
; touched by install/upgrade and is kept on uninstall unless "Delete my data too" is ticked.

Unicode true
Target amd64-unicode
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !define VERSION "0.0.1"
!endif
!ifndef VERSION4
  !define VERSION4 "${VERSION}.0"
!endif
!ifndef SRC_EXE
  !define SRC_EXE "../dist/MYCASH.exe"
!endif
!ifndef OUTFILE
  !define OUTFILE "../dist/MYCASH-${VERSION}-setup.exe"
!endif

!define APPNAME    "MYCASH"
!define APPEXE     "MYCASH.exe"
!define APPDESC    "MYCASH - debts and monthly cash flow (part of MYSUITE)"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MYCASH"
!define FW_RULE    "MYCASH LAN sync"
!define SYNC_PORT  "47870"
!define WV2_GUID   "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
Var WV2Missing
!define WV2_URL    "https://developer.microsoft.com/microsoft-edge/webview2/"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "WinMessages.nsh"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
BrandingText "${APPNAME} ${VERSION} · MYSUITE"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${VERSION4}"
VIFileVersion    "${VERSION4}"
VIAddVersionKey "ProductName"     "${APPNAME}"
VIAddVersionKey "ProductVersion"  "${VERSION}"
VIAddVersionKey "FileVersion"     "${VERSION}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "OriginalFilename" "MYCASH-${VERSION}-setup.exe"
VIAddVersionKey "LegalCopyright"  ""

!define MUI_ICON   "MYCASH.ico"
!define MUI_UNICON "MYCASH.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPEXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APPNAME} now"
!define MUI_FINISHPAGE_TEXT_LARGE
!define MUI_FINISHPAGE_TEXT "${APPNAME} has been installed. Start it from the Start menu.$\r$\n$\r$\nSync with your phone works only in your local network (Wi-Fi): keep MYCASH open on both devices. If Windows asks whether MYCASH may communicate on networks, allow private networks."

!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishShow
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_COMPONENTS
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------------------
; Close a running copy safely before the exe is replaced/removed.
; Test: a running exe cannot be opened for writing on Windows. If it is locked,
; ask (silent mode: proceed) and send WM_CLOSE once to each MYYT window
; (class "webview", title "MYCASH"); it saves on every change and exits on
; WM_CLOSE. Never kills processes.
!macro CLOSE_APP_FUNC un
Function ${un}CloseRunningApp
  Push $R0
  Push $R1
  Push $R2
  IfFileExists "$INSTDIR\${APPEXE}" 0 cra_done
  ClearErrors
  FileOpen $R0 "$INSTDIR\${APPEXE}" a
  IfErrors cra_locked
  FileClose $R0
  Goto cra_done
cra_locked:
  MessageBox MB_OKCANCEL|MB_ICONINFORMATION "${APPNAME} is running.$\r$\n$\r$\nClick OK to close it and continue, or Cancel to stop." /SD IDOK IDOK cra_close
  Abort "${APPNAME} is still running - nothing was changed."
cra_close:
  DetailPrint "Closing running ${APPNAME}..."
  StrCpy $R1 0
cra_find:
  FindWindow $R1 "webview" "${APPNAME}" 0 $R1
  ${If} $R1 <> 0
    SendMessage $R1 ${WM_CLOSE} 0 0 /TIMEOUT=3000
    Goto cra_find
  ${EndIf}
  StrCpy $R2 0
cra_wait:
  Sleep 500
  ClearErrors
  FileOpen $R0 "$INSTDIR\${APPEXE}" a
  ${IfNot} ${Errors}
    FileClose $R0
    Sleep 300
    Goto cra_done
  ${EndIf}
  IntOp $R2 $R2 + 1
  IntCmp $R2 20 0 cra_wait 0
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${APPNAME} could not be closed automatically.$\r$\nPlease close it (X button or Alt+F4) and click Retry." /SD IDCANCEL IDRETRY cra_retry
  Abort "${APPNAME} is still running - nothing was changed."
cra_retry:
  StrCpy $R2 0
  Goto cra_wait
cra_done:
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd
!macroend
!insertmacro CLOSE_APP_FUNC ""
!insertmacro CLOSE_APP_FUNC "un."

; WebView2 Evergreen Runtime detection (registry keys documented by Microsoft).
Function CheckWebView2
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WV2_GUID}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\${WV2_GUID}" "pv"
  ${EndIf}
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WV2_GUID}" "pv"
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} $0 != "0.0.0.0"
    DetailPrint "Microsoft Edge WebView2 Runtime found (version $0)."
  ${Else}
    StrCpy $WV2Missing 1
    DetailPrint "Microsoft Edge WebView2 Runtime NOT found - ${APPNAME} needs it to show its window."
    DetailPrint "Get the Evergreen Bootstrapper from ${WV2_URL}"
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "The Microsoft Edge WebView2 Runtime was not found.$\r$\n$\r$\n${APPNAME} needs this small Microsoft component for its window. It is preinstalled on Windows 11 and on most Windows 10 PCs (it is not the full Edge browser).$\r$\n$\r$\nOpen Microsoft's official WebView2 download page now?$\r$\n(Choose $\"Evergreen Bootstrapper$\" there, then start ${APPNAME}.)" /SD IDNO IDNO wv2_done
    ExecShell "open" "${WV2_URL}"
  wv2_done:
  ${EndIf}
FunctionEnd

; Don't offer "Start now" by default when the runtime is missing.
Function FinishShow
  ${If} $WV2Missing == 1
    ${NSD_Uncheck} $mui.FinishPage.Run
  ${EndIf}
FunctionEnd

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "${APPNAME} requires 64-bit Windows 10 or 11." /SD IDOK
    Quit
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd

; ---------------------------------------------------------------------------
Section "${APPNAME} (required)" SecMain
  SectionIn RO
  SetShellVarContext current
  Call CloseRunningApp

  SetOutPath "$INSTDIR"
  File "/oname=${APPEXE}" "${SRC_EXE}"
  File "/oname=README.txt" "README-windows.txt"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateShortcut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0 SW_SHOWNORMAL "" "${APPDESC}"

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName"          "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion"       "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher"            "MYSUITE"
  WriteRegStr HKCU "${UNINST_KEY}" "Comments"             "${APPDESC}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon"          "$\"$INSTDIR\${APPEXE}$\",0"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation"      "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString"      "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0

  Call CheckWebView2
SectionEnd

Section /o "Desktop shortcut" SecDesktop
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0 SW_SHOWNORMAL "" "${APPDESC}"
SectionEnd

; Optional: a Windows Firewall rule so phones in the local network can reach MYCASH (private networks only).
; Needs one administrator confirmation (UAC). Without it, Windows asks the first time MYCASH starts listening.
Section "Allow LAN sync in Windows Firewall (asks for admin)" SecFirewall
  ${IfNot} ${Silent}
    DetailPrint "Adding firewall rule '${FW_RULE}' (TCP ${SYNC_PORT}, private networks)..."
    ExecShellWait "runas" "$SYSDIR\netsh.exe" 'advfirewall firewall add rule name="${FW_RULE}" dir=in action=allow program="$INSTDIR\${APPEXE}" protocol=TCP localport=${SYNC_PORT} profile=private' SW_HIDE
    WriteRegDWORD HKCU "${UNINST_KEY}" "FirewallRule" 1
  ${EndIf}
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain}     "The ${APPNAME} program, a Start menu shortcut and its Apps & features entry."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop}  "Also put a shortcut on the desktop."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecFirewall} "Lets your phone reach MYCASH in your home network (TCP ${SYNC_PORT}, private networks only). Windows asks for administrator confirmation once."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ---------------------------------------------------------------------------
Section "un.${APPNAME}" SecUnMain
  SectionIn RO
  SetShellVarContext current
  Call un.CloseRunningApp
  ReadRegDWORD $0 HKCU "${UNINST_KEY}" "FirewallRule"
  ${If} $0 == 1
  ${AndIfNot} ${Silent}
    ExecShellWait "runas" "$SYSDIR\netsh.exe" 'advfirewall firewall delete rule name="${FW_RULE}"' SW_HIDE
  ${EndIf}
  Delete "$INSTDIR\${APPEXE}"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"            ; only if empty - never removes foreign files
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  Delete "$DESKTOP\${APPNAME}.lnk"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd

Section /o "un.Delete my data too" SecUnData
  SetShellVarContext current
  ${If} $LOCALAPPDATA != ""
  ${AndIf} ${FileExists} "$LOCALAPPDATA\${APPNAME}\*.*"
    DetailPrint "Removing $LOCALAPPDATA\${APPNAME}"
    RMDir /r "$LOCALAPPDATA\${APPNAME}"
  ${EndIf}
SectionEnd

!insertmacro MUI_UNFUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecUnMain} "Remove the program, its shortcuts and its Apps & features entry."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecUnData} "Also delete all your MYCASH data (debts, months, paired devices). Not ticked = your data in %LOCALAPPDATA%\${APPNAME} is kept for a later reinstall."
!insertmacro MUI_UNFUNCTION_DESCRIPTION_END
