import { MaterialIcon } from "../MaterialIcon.tsx";

export function McpServerErrorPanel({
  approving = false,
  error,
  onApproveStdioServers,
}: {
  approving?: boolean;
  error: string;
  onApproveStdioServers?(): void;
}) {
  const needsApproval = isMcpStdioApprovalRequiredError(error);
  const approvalKey = needsApproval ? mcpStdioApprovalKeyFromError(error) : null;

  return (
    <div className="mt-3 rounded-sm border border-error-container bg-error-container/25 px-3 py-2 text-on-error-container">
      <div className="flex min-w-0 items-start gap-2">
        <MaterialIcon className="mt-0.5 shrink-0 text-error" name="error" size={16} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-error">
            {needsApproval ? "MCP server needs browser approval" : "MCP server failed to start"}
          </p>
          <p
            className={[
              "mt-1 break-words text-[0.72rem] leading-5 text-on-error-container",
              needsApproval ? "" : "font-mono",
            ].join(" ")}
          >
            {needsApproval
              ? "Truss blocks external stdio MCP commands until you approve the current mcp.json commands in the browser."
              : error}
          </p>
          {approvalKey ? (
            <p className="mt-1 break-words font-mono text-[0.7rem] leading-5 text-on-error-container/85">
              Approval key: {approvalKey}
            </p>
          ) : null}
          {needsApproval && onApproveStdioServers ? (
            <button
              className="mt-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-error-container bg-surface px-2.5 text-xs font-semibold text-on-surface-variant transition hover:border-outline hover:bg-surface-container-low hover:text-primary focus-visible:border-outline focus-visible:bg-surface focus-visible:text-primary focus-visible:outline-none disabled:opacity-60"
              disabled={approving}
              onClick={onApproveStdioServers}
              type="button"
            >
              {approving ? (
                <span className="truss-spinner h-3.5 w-3.5 rounded-full border-2 border-current/30 border-t-current" />
              ) : (
                <MaterialIcon name="verified_user" size={15} />
              )}
              {approving ? "Approving" : "Approve and reload"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function isMcpStdioApprovalRequiredError(error: string): boolean {
  return (
    error.includes("not approved for local process execution") &&
    error.includes("Approve this command from the browser")
  );
}

function mcpStdioApprovalKeyFromError(error: string): string | null {
  return /Approval key:\s*([a-f0-9]{64})/i.exec(error)?.[1] ?? null;
}
