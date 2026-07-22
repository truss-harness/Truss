import { describe, expect, it } from "bun:test";
import {
  sharedFilesForActivity,
  type ActivitySharedFile,
} from "../../src/client/components/chat/activity-shared-files.ts";
import type { ChatAttachment } from "../../src/shared/protocol.ts";
import type { ChatUiMessage } from "../../src/client/components/chat/types.ts";

describe("activity shared files", () => {
  it("lists direct attachments from messages", () => {
    expect(
      sharedFilesForActivity([
        message({
          id: "image",
          kind: "image",
          mimeType: "image/png",
          name: "screen.png",
          size: 4096,
        }),
      ]),
    ).toEqual<ActivitySharedFile[]>([
      {
        dataUrl: "data:text/plain;base64,",
        downloadName: "screen.png",
        id: "image",
        kind: "image",
        mimeType: "image/png",
        name: "screen.png",
        size: 4096,
      },
    ]);
  });

  it("deduplicates converted document pages by source file", () => {
    expect(
      sharedFilesForActivity([
        message(
          {
            id: "plan-page-1",
            kind: "image",
            mimeType: "image/png",
            name: "plan-page-1.png",
            size: 8192,
            sourceFormat: "PDF",
            sourceMimeType: "application/pdf",
            sourceName: "Plan.pdf",
            sourcePage: 1,
            sourcePageCount: 2,
          },
          {
            id: "plan-page-2",
            kind: "image",
            mimeType: "image/png",
            name: "plan-page-2.png",
            size: 8192,
            sourceFormat: "PDF",
            sourceMimeType: "application/pdf",
            sourceName: "Plan.pdf",
            sourcePage: 2,
            sourcePageCount: 2,
          },
        ),
      ]),
    ).toEqual<ActivitySharedFile[]>([
      {
        dataUrl: "data:text/plain;base64,",
        downloadName: "plan-page-1.png",
        id: "plan-page-1",
        kind: "document",
        mimeType: "application/pdf",
        name: "Plan.pdf",
        size: 8192,
        sourceFormat: "PDF",
        sourcePageCount: 2,
      },
    ]);
  });
});

function message(...attachments: Array<Omit<ChatAttachment, "dataUrl">>): ChatUiMessage {
  return {
    attachments: attachments.map((attachment) => ({
      dataUrl: "data:text/plain;base64,",
      ...attachment,
    })),
    content: "",
    createdAt: "2026-06-27T10:00:00.000Z",
    id: "message",
    role: "user",
  };
}
