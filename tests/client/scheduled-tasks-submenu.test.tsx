import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ContextMenuSubmenu,
  ContextMenuButton,
} from "../../src/client/components/chat/ConversationSidebar.tsx";

function renderScheduledTasksMenuBranch(sessions: unknown[]): string {
  return renderToStaticMarkup(
    createElement(
      ContextMenuSubmenu,
      { icon: "schedule", label: "Scheduled Tasks", wide: true },
      createElement(ContextMenuButton, {
        disabled: false,
        icon: "schedule",
        label: "Manage scheduled tasks",
        onClick: () => {},
      }),
      createElement("div", { className: "my-1 border-t border-outline-variant/70" }),
      sessions.length === 0
        ? createElement(
            "p",
            { className: "px-3 py-3 text-sm leading-5 text-on-surface-variant" },
            "No scheduled task sessions yet",
          )
        : sessions.map((session) =>
            createElement(ContextMenuButton, {
              disabled: false,
              icon: "smart_toy",
              key: (session as { id: string }).id,
              label: `${(session as { taskName: string }).taskName} ${(session as { runStartedAt: string }).runStartedAt.slice(0, 16).replace("T", " ")}`,
              onClick: () => {},
            }),
          ),
    ),
  );
}

describe("Scheduled Tasks submenu", () => {
  it("renders the branch, manage item, and empty state", () => {
    const markup = renderScheduledTasksMenuBranch([]);

    expect(markup).toContain("Scheduled Tasks");
    expect(markup).toContain("Manage scheduled tasks");
    expect(markup).toContain("No scheduled task sessions yet");
    expect(markup).toContain("truss-sidebar-menu-branch");
  });

  it("renders scheduled task session items with task name and timestamp", () => {
    const markup = renderScheduledTasksMenuBranch([
      {
        id: "session_one",
        taskName: "Daily summary",
        runStartedAt: "2026-07-15T13:48:00.000Z",
      },
    ]);

    expect(markup).toContain("Daily summary 2026-07-15 13:48");
  });
});
