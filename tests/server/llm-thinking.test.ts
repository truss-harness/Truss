import { describe, expect, it } from "bun:test";
import { setTimeout as sleep } from "timers/promises";
import {
  createReasoningBudgetMonitor,
  ReasoningBudgetExceededError,
} from "../../src/server/llm/reasoning-budget.ts";
import {
  mergeChatThinking,
  splitThinkBlocksFromText,
  ThinkBlockParser,
  thinkingFromOpenAiCompatibleResponse,
} from "../../src/server/llm/thinking.ts";

describe("ThinkBlockParser", () => {
  it("streams content and thinking when tags are split across chunks", () => {
    const parser = new ThinkBlockParser();

    expect(parser.push("hello <thi")).toEqual({
      content: "hello ",
      thinking: "",
      thinkingStarted: false,
    });
    expect(parser.push("nk>chain")).toEqual({
      content: "",
      thinking: "chain",
      thinkingStarted: true,
    });
    expect(parser.push(" of thought</THINK> answer")).toEqual({
      content: " answer",
      thinking: " of thought",
      thinkingStarted: false,
    });
    expect(parser.flush()).toEqual({
      content: "",
      thinking: "",
      thinkingStarted: false,
    });
  });

  it("flushes incomplete tag text back into normal content", () => {
    const parser = new ThinkBlockParser();

    expect(parser.push("plain <thi")).toEqual({
      content: "plain ",
      thinking: "",
      thinkingStarted: false,
    });
    expect(parser.flush()).toEqual({
      content: "<thi",
      thinking: "",
      thinkingStarted: false,
    });
  });

  it("extracts think blocks from non-streaming response text", () => {
    expect(splitThinkBlocksFromText("<think>search first</think>Use the result.")).toEqual({
      content: "Use the result.",
      thinking: "search first",
    });
  });

  it("extracts think blocks from <thinking> tags and tagged close markers", () => {
    expect(splitThinkBlocksFromText("<thinking>search first</think:{abc}>Use the result.")).toEqual({
      content: "Use the result.",
      thinking: "search first",
    });
  });

  it("extracts think blocks from </thinking> close tags", () => {
    expect(splitThinkBlocksFromText("<thinking>search first</thinking>Use the result.")).toEqual({
      content: "Use the result.",
      thinking: "search first",
    });
  });
});

describe("thinking helpers", () => {
  it("extracts provider reasoning text from OpenAI-compatible responses", () => {
    const thinking = thinkingFromOpenAiCompatibleResponse(
      {
        choices: [
          {
            message: {
              reasoning_content: " compare options ",
            },
          },
        ],
      },
      Date.now(),
    );

    expect(thinking?.content).toBe("compare options");
    expect(thinking?.wordCount).toBe(2);
  });

  it("extracts encrypted reasoning content from OpenAI-compatible responses", () => {
    const thinking = thinkingFromOpenAiCompatibleResponse(
      {
        choices: [
          {
            message: {
              reasoning: {
                encrypted_content: "opaque-reasoning-state",
              },
            },
          },
        ],
      },
      Date.now(),
    );

    expect(thinking?.content).toBe("");
    expect(thinking?.encryptedContent).toBe("opaque-reasoning-state");
    expect(thinking?.wordCount).toBe(0);
  });

  it("merges thinking blocks and recalculates the word count", () => {
    expect(
      mergeChatThinking(
        {
          content: "first idea",
          durationMs: 10,
          encryptedContent: "first-state",
          wordCount: 2,
        },
        {
          content: "second idea",
          durationMs: 15,
          encryptedContent: "second-state",
          wordCount: 2,
        },
      ),
    ).toEqual({
      content: "first idea\n\nsecond idea",
      durationMs: 25,
      encryptedContent: "second-state",
      wordCount: 4,
    });
  });

  it("preserves tool-call thinking while merging thinking blocks", () => {
    const merged = mergeChatThinking(
      {
        content: "first idea",
        durationMs: 10,
        toolCalls: [
          {
            args: {},
            completedAt: "2026-06-25T00:00:01.000Z",
            id: "tool_1",
            result: "first result",
            startedAt: "2026-06-25T00:00:00.000Z",
            status: "completed",
            thinkingAfter: "review first result",
            title: "Demo tool",
            toolId: "demo_tool",
          },
        ],
        wordCount: 2,
      },
      {
        content: "second idea",
        durationMs: 15,
        toolCalls: [
          {
            args: {},
            completedAt: "2026-06-25T00:00:02.000Z",
            id: "tool_1",
            result: "first result",
            startedAt: "2026-06-25T00:00:00.000Z",
            status: "completed",
            thinkingAfter: "choose second step",
            title: "Demo tool",
            toolId: "demo_tool",
          },
          {
            args: {},
            id: "tool_2",
            startedAt: "2026-06-25T00:00:03.000Z",
            status: "running",
            thinkingBefore: "choose second step",
            title: "Demo tool",
            toolId: "demo_tool",
          },
        ],
        wordCount: 2,
      },
    );

    expect(merged?.content).toBe("first idea\n\nsecond idea");
    expect(merged?.toolCalls?.map((toolCall) => toolCall.id)).toEqual(["tool_1", "tool_2"]);
    expect(merged?.toolCalls?.[0]?.thinkingAfter).toBe(
      "review first result\n\nchoose second step",
    );
    expect(merged?.toolCalls?.[1]?.thinkingBefore).toBe("choose second step");
  });
});

describe("createReasoningBudgetMonitor", () => {
  it("does nothing when no limit is configured", () => {
    let aborted = false;
    const monitor = createReasoningBudgetMonitor(null, () => {
      aborted = true;
    });

    monitor.check({ content: "one two three", durationMs: 10_000, wordCount: 3 });

    expect(aborted).toBe(false);
    expect(monitor.exceeded).toBe(false);
    monitor.dispose();
  });

  it("aborts and throws when the word budget is exceeded", () => {
    let aborted = false;
    const monitor = createReasoningBudgetMonitor(
      {
        maxDurationMs: 60_000,
        maxWords: 2,
      },
      () => {
        aborted = true;
      },
    );

    expect(() =>
      monitor.check({ content: "one two three", durationMs: 5, wordCount: 3 }),
    ).toThrow(ReasoningBudgetExceededError);
    expect(aborted).toBe(true);
    expect(monitor.exceeded).toBe(true);
    expect(monitor.thinking?.content).toBe("one two three");
    monitor.dispose();
  });

  it("charges elapsed non-thinking time against the duration budget", () => {
    let aborted = false;
    const monitor = createReasoningBudgetMonitor(
      {
        maxDurationMs: 60_000,
        maxWords: 100,
      },
      () => {
        aborted = true;
      },
    );

    monitor.check({ content: "one two", durationMs: 30_000, wordCount: 2 });

    expect(() => monitor.chargeElapsed(31_000)).toThrow(ReasoningBudgetExceededError);
    expect(aborted).toBe(true);
    expect(monitor.exceeded).toBe(true);
    expect(monitor.thinking?.durationMs).toBe(61_000);
    expect(monitor.thinking?.content).toBe("one two");
    monitor.dispose();
  });

  it("fires the timer based on live elapsed time, not stale thinking durationMs snapshot", async () => {
    let aborted = false;
    const monitor = createReasoningBudgetMonitor(
      {
        maxDurationMs: 80,
        maxWords: 1_000,
      },
      () => {
        aborted = true;
      },
    );

    // check() is called with a stale durationMs of 0 — as if the thinking delta
    // just arrived but the snapshot was taken at t=0. Without the fix, scheduleTimer
    // would use durationMs=0 and set a timer for the full 80ms from now, causing it
    // to fire ~80ms after this check() call even though start() was called earlier.
    monitor.start();

    // Burn ~50ms of real wall-clock time before calling check()
    await sleep(50);

    // Pass a stale durationMs snapshot (0) — this is what the old code relied on
    monitor.check({ content: "hello", durationMs: 0, wordCount: 1 });

    // With the fix, only ~30ms remain; wait 60ms — the timer must have fired by now
    await sleep(60);

    expect(aborted).toBe(true);
    monitor.dispose();
  });
});
