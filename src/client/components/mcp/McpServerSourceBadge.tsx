import type { McpServerConnectionSummary } from "../../../shared/protocol.ts";

export function McpServerSourceBadge({ server }: { server: McpServerConnectionSummary }) {
  const badge = mcpServerSourceBadge(server);

  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[0.68rem] font-semibold leading-none",
        badge.className,
      ].join(" ")}
    >
      {badge.label}
    </span>
  );
}

function mcpServerSourceBadge(server: McpServerConnectionSummary): {
  className: string;
  label: string;
} {
  if (server.trussManaged) {
    return {
      label: "Built-in MCP Server",
      className: "border-emerald-600/25 bg-emerald-50 text-emerald-800",
    };
  }

  if (server.source === "truss-global") {
    return {
      label: "Global MCP Server",
      className: "border-sky-600/25 bg-sky-50 text-sky-800",
    };
  }

  return {
    label: "Workspace discovered MCP Server",
    className: "border-amber-600/25 bg-amber-50 text-amber-900",
  };
}
