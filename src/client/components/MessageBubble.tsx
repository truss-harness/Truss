import { MarkdownView } from "../markdown.tsx";
import type { Message } from "../types.ts";

export function MessageBubble({ message }: { message: Message }) {
  return (
    <article
      className={`rounded-lg p-4 ${
        message.role === "user"
          ? "ml-auto max-w-[86%] border border-secondary-container bg-secondary-container/45"
          : "mr-auto max-w-[92%] bg-transparent"
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-on-surface-variant">
          {message.role}
        </span>
        {message.streaming ? (
          <span className="rounded bg-tertiary-container/10 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.12em] text-tertiary-container">
            streaming
          </span>
        ) : null}
      </div>
      <MarkdownView source={message.content} />
    </article>
  );
}
