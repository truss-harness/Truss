# Truss Windows Package

This package layout installs the compiled `truss.exe` for the current Windows
user and adds desktop-session affordances around it.

## Build

From the repository root:

```powershell
bun run package:windows
```

The build script compiles `dist\truss.exe`, stages the installable package under
`dist\windows\Truss`, downloads `WinSW-x64.exe` as `truss-service.exe`, and writes
`dist\windows\truss-windows-x64-<version>.zip`.

If the build host cannot download WinSW, pass an explicit wrapper path:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\windows\build-package.ps1 -WinSWPath C:\path\to\WinSW-x64.exe
```

To also build an Inno Setup installer executable, install Inno Setup and run:

```powershell
bun run package:windows:installer
```

The build script finds `ISCC.exe` on `Path` or in the standard Inno Setup 6/5
install directories. If it is installed somewhere else, pass the compiler path:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\windows\build-package.ps1 -BuildInstaller -InnoSetupCompiler "C:\path\to\ISCC.exe"
```

## Install From The Zip

Extract the zip, open a PowerShell session in the extracted folder, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-truss.ps1
```

The installer:

- copies Truss to `%LOCALAPPDATA%\Programs\Truss`;
- adds the install directory to the current user's `Path`, so `truss` works in new terminals;
- creates current-user Start Menu entries under `Truss`;
- adds a **Spawn Truss agent here** entry to the folder context menu for folders and empty folder backgrounds;
- registers the tray helper in the current user's Run key and starts it;
- starts the backend as the signed-in Windows user, so Truss data stays under `%USERPROFILE%\.truss`.

The installer also uses the Truss icon and logo for its window styling when the source images are available.

The Start Menu `Truss` entry starts Truss if necessary and opens
`http://127.0.0.1:7805/`.

The tray helper includes:

- `Open Truss`;
- `Browse Folder and Open in Truss...`;
- start, stop, and restart actions;
- `Exit Tray`.

The folder action launches `truss.exe spawn <selected folder>` as an interactive
scoped Truss instance. Because the main user-mode instance normally owns port
`7805`, the scoped instance can use Truss's dynamic fallback port and open the
browser itself.

If a previous machine-wide `Truss` Windows service is installed, remove it from
an elevated PowerShell session before installing the per-user package. That old
service runs under `LocalSystem` and will not use your `%USERPROFILE%\.truss`
home directory.

## Uninstall

From a PowerShell session:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\Truss\uninstall-truss.ps1" -RemoveFiles
```

This removes the current-user `Path` entry, Start Menu entries, folder context
menu entry, and tray autostart. Truss user data under `%USERPROFILE%\.truss` is
intentionally left in place. If an optional Windows service was installed,
removing that service still requires an elevated PowerShell session.

## Service Wrapper

The package still includes WinSW, the Windows Service Wrapper, for explicit
service-mode installs, but the default package runs Truss in the signed-in user
session. See `https://github.com/winsw/winsw`.
