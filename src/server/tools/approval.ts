import type { ToolApprovalResolutionRequest } from "../../shared/protocol.ts";

export interface ToolApprovalDecision {
  approved: boolean;
  payload?: unknown;
  rejectedReason?: string;
}

export function normalizeApprovalResolution(
  request: ToolApprovalResolutionRequest,
): ToolApprovalDecision {
  if (!request.approved) {
    return {
      approved: false,
      rejectedReason: "Rejected by browser approval callback.",
    };
  }

  return {
    approved: true,
    payload: request.payload,
  };
}
