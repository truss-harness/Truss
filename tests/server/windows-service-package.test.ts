import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const packageDir = join(process.cwd(), "packaging", "windows");

describe("Windows service package", () => {
  it("installs the explicit LocalSystem service runtime as mandatory", async () => {
    const [serviceXml, installer, innoSetup] = await Promise.all([
      Bun.file(join(packageDir, "truss-service.xml")).text(),
      Bun.file(join(packageDir, "install-truss.ps1")).text(),
      Bun.file(join(packageDir, "truss.iss")).text(),
    ]);

    expect(serviceXml).toContain("<arguments>service</arguments>");
    expect(serviceXml).toContain("<user>LocalSystem</user>");
    expect(serviceXml).toContain("TRUSS_SERVICE_HOME");
    expect(installer).toContain("Install-TrussService -TargetDir $InstallDir");
    expect(installer).not.toContain("[switch]$NoService");
    expect(installer).not.toContain("[switch]$InstallService");
    expect(innoSetup).toContain("PrivilegesRequired=admin");
    expect(innoSetup).toContain("DefaultDirName={autopf}\\Truss");
  });

  it("does not package or launch a user-process service fallback", async () => {
    const [openScript, buildScript, serviceXml] = await Promise.all([
      Bun.file(join(packageDir, "open-truss.ps1")).text(),
      Bun.file(join(packageDir, "build-package.ps1")).text(),
      Bun.file(join(packageDir, "truss-service.xml")).text(),
    ]);

    expect(openScript).not.toContain("Start-TrussProcessFallback");
    expect(openScript).toContain("required Truss Windows service");
    expect(buildScript).toContain('Destination (Join-Path $stageRoot "node.exe")');
    expect(serviceXml).not.toContain("spawn --no-autolaunch");
  });
});
