export type RuntimeMode = "foreground" | "background-service";

export interface RuntimeModeOptions {
  requestedBackground: boolean;
  platform: NodeJS.Platform;
}

export interface RuntimeModeDecision {
  mode: RuntimeMode;
  notes: string[];
}

export function decideRuntimeMode(options: RuntimeModeOptions): RuntimeModeDecision {
  if (!options.requestedBackground) {
    return {
      mode: "foreground",
      notes: ["Running as an interactive foreground process."],
    };
  }

  if (options.platform === "win32") {
    return {
      mode: "background-service",
      notes: [
        "Windows service mode requested.",
        "Future implementation should preserve stdio MCP child processes across sessions.",
      ],
    };
  }

  return {
    mode: "background-service",
    notes: [
      "Background runner requested.",
      "Future implementation should map to launchd on macOS or systemd on Linux.",
    ],
  };
}
