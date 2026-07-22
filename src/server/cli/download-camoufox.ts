import { installCamoufox, defaultCamoufoxReleaseTag } from "../utils/camoufox-browser.ts";
import { resolve } from "node:path";
import process from "node:process";

async function main() {
  const args = process.argv.slice(2);
  const installDir = args[0] ? resolve(args[0]) : null;

  if (!installDir) {
    console.error("Usage: download-camoufox <install-dir> [release-tag]");
    process.exit(1);
  }

  const releaseTag = args[1] || defaultCamoufoxReleaseTag;

  try {
    await installCamoufox({
      installDir,
      log: (channel, message, metadata) => {
        console.log(`[${channel}] ${message}`, metadata || "");
      },
      releaseTag,
    });
    console.log(`Camoufox ${releaseTag} installed to ${installDir}`);
  } catch (error) {
    console.error("Failed to install Camoufox:", error);
    process.exit(1);
  }
}

void main();
