import { useState } from "react";
import type { FormEvent } from "react";
import { EditorialButton } from "./editorial.tsx";

export function CommandComposer({ onSubmit }: { onSubmit: (command: string) => Promise<void> }) {
  const [command, setCommand] = useState("");
  const [isSending, setIsSending] = useState(false);

  async function submitCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = command.trim();

    if (!trimmed) {
      return;
    }

    setIsSending(true);

    try {
      await onSubmit(trimmed);
      setCommand("");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <form onSubmit={submitCommand} className="border-t border-outline-variant p-4 md:p-5">
      <div className="flex flex-col gap-3 rounded border border-outline-variant bg-surface-container-low p-3 shadow-[inset_0_1px_3px_rgba(27,28,25,0.02)] sm:flex-row">
        <textarea
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          rows={2}
          className="min-h-16 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-on-surface outline-none placeholder:text-on-surface-variant/40"
          placeholder="Ask Truss to inspect the workspace, or type /tool for the sample UI callback."
        />
        <EditorialButton
          type="submit"
          disabled={isSending}
          className="self-stretch px-5 py-3 sm:self-end"
        >
          {isSending ? "Sending" : "Send"}
        </EditorialButton>
      </div>
    </form>
  );
}
