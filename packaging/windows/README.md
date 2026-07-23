# Truss Windows Package

This package installs `truss.exe`, the mandatory global `LocalSystem` Windows
service, and desktop-session affordances around it.

## Build

From the repository root:

```powershell
bun run package:windows
```

The build script compiles `dist\truss.exe`, stages the installable package under
`dist\windows\Truss`, downloads `WinSW-x64.exe` as `truss-service.exe`, and writes
`dist\windows\truss-windows-x64-<version>.zip`.

The staged package includes `node.exe`, the Camoufox launcher bridge, the
Node-hosted PDF image renderer, and its native canvas dependency.

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

Extract the zip, open an elevated PowerShell session in the extracted folder,
and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-truss.ps1
```

The installer:

- copies Truss to `%ProgramFiles%\Truss`;
- installs the automatic `Truss` service explicitly as `LocalSystem`;
- adds the install directory to the current user's `Path`, so `truss` works in new terminals;
- creates current-user Start Menu entries under `Truss`;
- adds a **Spawn Truss agent here** entry to the folder context menu for folders and empty folder backgrounds;
- registers the tray helper in the current user's Run key and starts it;
- starts the service with its home under `%ProgramData%\Truss`.

The installer also uses the Truss icon and logo for its window styling when the source images are available.

The Start Menu `Truss` entry starts Truss if necessary and opens
`http://127.0.0.1:7805/`.

The tray helper includes:

- `Open Truss`;
- `Browse Folder and Open in Truss...`;
- start, stop, and restart actions;
- `Exit Tray`.

The folder action asks the global service to launch the scoped Truss instance.
The service passes its short-lived browser broker capability through the child
environment; manually launched scoped processes do not receive it.

## Uninstall

From a PowerShell session:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:ProgramFiles\Truss\uninstall-truss.ps1" -RemoveFiles
```

This removes the required service, current-user `Path` entry, Start Menu
entries, folder context menu entry, and tray autostart. Service data under
`%ProgramData%\Truss` is intentionally left in place.

## Service Wrapper

The package uses WinSW to run `truss.exe service` as `LocalSystem`. The service
owns the only Camoufox process and its authenticated loopback broker. See
`https://github.com/winsw/winsw`.
