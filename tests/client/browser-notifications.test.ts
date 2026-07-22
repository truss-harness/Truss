import { describe, expect, it } from "bun:test";
import type { ChatUserChoiceRequest } from "../../src/shared/protocol.ts";
import {
  sessionFinishedNotification,
  userChoiceNotification,
} from "../../src/client/browser-notifications.ts";

describe("browser notification copy", () => {
  it("builds a session-finished notification", () => {
    expect(sessionFinishedNotification("session-123")).toEqual({
      body: "The session is ready for your next message.",
      tag: "truss-session-finished-session-123",
      title: "Truss session finished",
    });
  });

  it("summarizes directory-access requests", () => {
    const notification = userChoiceNotification({
      ...baseChoiceRequest("choice-directory"),
      directoryAccess: {
        directoryPath: "C:\\Users\\ASUS\\Documents\\Repo",
        readOnly: true,
        reason: "Inspect docs.",
      },
      kind: "directory_access",
      title: "Allow directory access",
    });

    expect(notification).toEqual({
      body: "Review read-only file access for C:\\Users\\ASUS\\Documents\\Repo.",
      tag: "truss-user-choice-choice-directory",
      title: "Truss needs your input",
    });
  });

  it("summarizes command approval requests", () => {
    const notification = userChoiceNotification({
      ...baseChoiceRequest("choice-command"),
      commandApproval: {
        accessesOutsideWhitelist: true,
        command: "bun test tests/server/user-choice.test.ts",
        safetyLevel: "risky",
        safetyReasoning: "Runs project tests.",
        summary: "Run focused user-choice tests.",
      },
      kind: "command_approval",
      title: "Approve command",
    });

    expect(notification.body).toBe("Review command approval: Run focused user-choice tests.");
  });

  it("keeps long generic questions compact", () => {
    const notification = userChoiceNotification({
      ...baseChoiceRequest("choice-long"),
      question: `Pick a branch. ${"This option has lengthy context. ".repeat(12)}`,
    });

    expect(notification.body.length).toBeLessThanOrEqual(180);
    expect(notification.body.endsWith("...")).toBe(true);
  });
});

function baseChoiceRequest(id: string): ChatUserChoiceRequest {
  return {
    allowCustomOption: false,
    customOptionLabel: "Something else",
    customOptionPlaceholder: "Type a different answer",
    icon: "help",
    id,
    kind: "choice",
    options: [],
    question: "Pick a branch.",
    title: "Choose an option",
  };
}
