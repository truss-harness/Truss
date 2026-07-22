import { useMemo, useState } from "react";
import type { ToolRequestEvent } from "../shared/protocol.ts";
import { highlightCode } from "./markdown.tsx";

interface ToolComponentProps {
  event: ToolRequestEvent;
  onResolve: (executionId: string, payload: unknown) => Promise<void>;
}

type ToolComponent = (props: ToolComponentProps) => React.ReactNode;

const registry: Record<string, ToolComponent> = {
  clarify_next_step: ClarifyNextStepTool,
};

export function ToolCard(props: ToolComponentProps) {
  const Component = resolveToolComponent(props.event);

  return (
    <article className="mr-auto max-w-[92%] rounded-lg border border-tertiary-container/30 bg-tertiary-container/10 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-tertiary-container">
            {props.event.origin === "mcp" ? "mcp tool approval" : "intercepted tool"}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-on-surface">
            {props.event.title}
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded bg-surface-container-lowest px-3 py-1 font-mono text-[0.68rem] text-on-surface-variant">
            {props.event.origin}
          </span>
          <span className="rounded bg-surface-container-lowest px-3 py-1 font-mono text-[0.68rem] text-on-surface-variant">
            {props.event.toolId}
          </span>
        </div>
      </div>
      {props.event.mcp ? (
        <p className="mb-3 rounded bg-surface-container-lowest px-3 py-2 font-mono text-xs text-on-surface-variant">
          {props.event.mcp.serverId} / {props.event.mcp.toolName}
        </p>
      ) : null}
      <Component {...props} />
    </article>
  );
}

function resolveToolComponent(event: ToolRequestEvent): ToolComponent {
  const component = registry[event.toolId];

  if (component) {
    return component;
  }

  if (event.origin === "mcp") {
    return GenericMcpTool;
  }

  return UnknownTool;
}

function ClarifyNextStepTool({ event, onResolve }: ToolComponentProps) {
  const args = useMemo(() => normalizeClarificationArgs(event.args), [event.args]);
  const [choice, setChoice] = useState(args.options[0] ?? "");
  const [note, setNote] = useState("");
  const [isResolving, setIsResolving] = useState(false);

  async function submitResolution() {
    setIsResolving(true);

    try {
      await onResolve(event.executionId, {
        choice,
        note,
        resolvedAt: new Date().toISOString(),
      });
    } finally {
      setIsResolving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-on-surface-variant">{args.question}</p>
      <div className="grid gap-2">
        {args.options.map((option) => (
          <label
            key={option}
            className={`cursor-pointer rounded border p-3 text-sm transition ${
              choice === option
                ? "border-primary bg-surface-container-lowest text-on-surface"
                : "border-outline-variant bg-surface-container-low text-on-surface-variant hover:border-outline"
            }`}
          >
            <input
              type="radio"
              name={event.executionId}
              value={option}
              checked={choice === option}
              onChange={() => setChoice(option)}
              className="sr-only"
            />
            {option}
          </label>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(inputEvent) => setNote(inputEvent.target.value)}
        className="min-h-20 w-full resize-none rounded border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none placeholder:text-on-surface-variant/40 focus:border-primary focus:ring-1 focus:ring-primary"
        placeholder="Optional note for the resumed backend context."
      />
      <button
        type="button"
        onClick={submitResolution}
        disabled={isResolving || !choice}
        className="rounded border border-tertiary-container bg-tertiary-container px-4 py-3 text-sm font-medium text-on-tertiary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isResolving ? "Resolving" : "Resolve Tool"}
      </button>
    </div>
  );
}

function UnknownTool({ event, onResolve }: ToolComponentProps) {
  const [isResolving, setIsResolving] = useState(false);

  async function resolveUnknownTool() {
    setIsResolving(true);

    try {
      await onResolve(event.executionId, {
        accepted: true,
        args: event.args,
      });
    } finally {
      setIsResolving(false);
    }
  }

  return (
    <div className="space-y-4">
      <JsonPayloadPreview value={event.args} />
      <button
        type="button"
        onClick={resolveUnknownTool}
        disabled={isResolving}
        className="rounded border border-primary bg-primary px-4 py-3 text-sm font-medium text-on-primary disabled:opacity-50"
      >
        {isResolving ? "Resolving" : "Accept Payload"}
      </button>
    </div>
  );
}

function GenericMcpTool({ event, onResolve }: ToolComponentProps) {
  const [isResolving, setIsResolving] = useState(false);

  async function submitDecision(approved: boolean) {
    setIsResolving(true);

    try {
      await onResolve(event.executionId, {
        approved,
        payload: approved
          ? {
              args: event.args,
              approvedAt: new Date().toISOString(),
            }
          : undefined,
      });
    } finally {
      setIsResolving(false);
    }
  }

  return (
    <div className="space-y-4">
      {event.approval ? (
        <p className="rounded border border-tertiary-container/20 bg-surface-container-lowest p-3 text-sm leading-6 text-on-surface-variant">
          {event.approval.reason}
        </p>
      ) : null}
      <JsonPayloadPreview value={event.args} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void submitDecision(true)}
          disabled={isResolving}
          className="rounded border border-tertiary-container bg-tertiary-container px-4 py-3 text-sm font-medium text-on-tertiary disabled:opacity-50"
        >
          {isResolving ? "Resolving" : "Approve MCP Tool"}
        </button>
        <button
          type="button"
          onClick={() => void submitDecision(false)}
          disabled={isResolving}
          className="rounded border border-outline-variant bg-transparent px-4 py-3 text-sm font-medium text-on-surface disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function JsonPayloadPreview({ value }: { value: unknown }) {
  const source = JSON.stringify(value, null, 2);

  return (
    <pre className="overflow-x-auto rounded bg-inverse-surface p-4 text-xs leading-5 text-inverse-on-surface">
      <code className="language-json">{highlightCode(source, "json")}</code>
    </pre>
  );
}

function normalizeClarificationArgs(args: Record<string, unknown>): {
  question: string;
  options: string[];
} {
  return {
    question:
      typeof args.question === "string"
        ? args.question
        : "Which path should Truss take next?",
    options: Array.isArray(args.options)
      ? args.options.filter((item): item is string => typeof item === "string")
      : ["Continue"],
  };
}
