Option Explicit

Dim shell
Dim fileSystem
Dim scriptDir
Dim powershell
Dim trayScript
Dim command

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
trayScript = fileSystem.BuildPath(scriptDir, "truss-tray.ps1")

If Not fileSystem.FileExists(powershell) Then
  WScript.Quit 1
End If

If Not fileSystem.FileExists(trayScript) Then
  WScript.Quit 1
End If

shell.CurrentDirectory = scriptDir
command = """" & powershell & """ -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & trayScript & """"
shell.Run command, 0, False
