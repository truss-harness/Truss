import { describe, expect, it } from "bun:test";
import { ChatUserChoiceStore } from "../../src/server/tools/chat-user-choice-store.ts";
import {
  createDirectoryAccessRequest,
  directoryAccessToolTitle,
} from "../../src/server/tools/file-access-request.ts";
import { createCommandApprovalRequest } from "../../src/server/tools/command-runner.ts";
import { createUserChoiceRequest } from "../../src/server/tools/user-choice.ts";

describe("ask_user_choice tool support", () => {
  it("normalizes dialog arguments with defaults", () => {
    const request = createUserChoiceRequest(
      {
        icon: "Tune",
        options: [
          {
            description: "Use the smaller change.",
            label: "Patch it",
            value: "patch",
          },
          "Explain first",
        ],
        question: "How should Truss proceed?",
      },
      "choice-test",
    );

    expect(request).toMatchObject({
      allowCustomOption: true,
      customOptionLabel: "Something else",
      customOptionPlaceholder: "Type a different answer",
      icon: "tune",
      id: "choice-test",
      question: "How should Truss proceed?",
      title: "Choose an option",
    });
    expect(request.options).toEqual([
      {
        description: "Use the smaller change.",
        id: "option-1",
        label: "Patch it",
        value: "patch",
      },
      {
        id: "option-2",
        label: "Explain first",
        value: "Explain first",
      },
    ]);
  });

  it("normalizes read-only directory access requests", () => {
    const request = createDirectoryAccessRequest(
      {
        directoryPath: "C:\\repo\\docs",
        readOnly: true,
        reason: "Inspect documentation.",
      },
      "choice-directory",
    );

    expect(request.directoryAccess).toEqual({
      directoryPath: "C:\\repo\\docs",
      readOnly: true,
      reason: "Inspect documentation.",
    });
    expect(request.options[0]?.label).toBe("Allow read-only");
    expect(request.question).toContain("read-only access");
    expect(
      directoryAccessToolTitle({
        directoryPath: "C:\\repo\\docs",
        readOnly: true,
      }),
    ).toBe("Request read-only directory access: C:\\repo\\docs");
  });

  it("normalizes command approval requests with structured guard details", () => {
    const request = createCommandApprovalRequest({
      command: "php artisan list --raw",
      id: "choice-command",
      verdict: {
        accessesOutsideWhitelist: false,
        safetyLevel: "dangerous",
        safetyReasoning: "The command invokes a shell pipeline that needs user review.",
        tldr: "List Laravel commands.",
      },
    });

    expect(request).toMatchObject({
      allowCustomOption: false,
      commandApproval: {
        accessesOutsideWhitelist: false,
        command: "php artisan list --raw",
        safetyLevel: "dangerous",
        safetyReasoning: "The command invokes a shell pipeline that needs user review.",
        summary: "List Laravel commands.",
      },
      icon: "terminal",
      id: "choice-command",
      kind: "command_approval",
      title: "Approve command",
    });
    expect(request.question).toContain("Security assessment reasoning:");
    expect(request.options.map((option) => option.label)).toEqual(["Allow once", "Deny"]);
  });

  it("resolves a pending choice to the selected option details", async () => {
    const store = new ChatUserChoiceStore();
    const request = createUserChoiceRequest(
      {
        options: [{ label: "One" }, { label: "Two", value: "two" }],
        question: "Pick one.",
      },
      "choice-option",
    );
    const result = store.waitForChoice(request, 10_000);

    expect(store.resolve(request.id, { optionId: "option-2" })).toEqual({ ok: true });
    await expect(result).resolves.toMatchObject({
      cancelled: false,
      question: "Pick one.",
      selectedOption: {
        id: "option-2",
        index: 1,
        label: "Two",
        value: "two",
      },
      selectionType: "option",
    });
  });

  it("resolves a pending choice to custom text when enabled", async () => {
    const store = new ChatUserChoiceStore();
    const request = createUserChoiceRequest(
      {
        options: [{ label: "One" }],
        question: "Pick one.",
      },
      "choice-custom",
    );
    const result = store.waitForChoice(request, 10_000);

    expect(store.resolve(request.id, { customResponse: "Use a different path" })).toEqual({
      ok: true,
    });
    await expect(result).resolves.toMatchObject({
      cancelled: false,
      customResponse: "Use a different path",
      question: "Pick one.",
      selectionType: "custom",
    });
  });

  it("rejects invalid custom responses without clearing the pending choice", async () => {
    const store = new ChatUserChoiceStore();
    const request = createUserChoiceRequest(
      {
        allowCustomOption: false,
        options: [{ label: "One" }],
        question: "Pick one.",
      },
      "choice-invalid-custom",
    );
    const result = store.waitForChoice(request, 10_000);

    expect(store.resolve(request.id, { customResponse: "No listed option fits" })).toEqual({
      ok: false,
      status: 400,
      error: "This choice does not accept a custom response.",
    });
    expect(store.resolve(request.id, { cancelled: true })).toEqual({ ok: true });
    await expect(result).resolves.toMatchObject({
      cancelled: true,
      reason: "user_cancelled",
    });
  });
});
