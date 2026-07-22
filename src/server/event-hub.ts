import type { SystemReadyEvent, TrussEvent } from "../shared/protocol.ts";

const encoder = new TextEncoder();

export class EventHub {
  readonly #clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  readonly #history: TrussEvent[] = [];

  constructor(readonly historyLimit = 60) {}

  publish(event: TrussEvent): void {
    this.#history.push(event);

    if (this.#history.length > this.historyLimit) {
      this.#history.splice(0, this.#history.length - this.historyLimit);
    }

    for (const client of this.#clients) {
      try {
        client.enqueue(encoder.encode(formatSse(event)));
      } catch {
        this.#clients.delete(client);
      }
    }
  }

  stream(readyEvent: SystemReadyEvent): Response {
    let activeClient: ReadableStreamDefaultController<Uint8Array> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        activeClient = controller;
        this.#clients.add(controller);
        controller.enqueue(encoder.encode(": truss stream connected\n\n"));

        for (const event of this.#history) {
          controller.enqueue(encoder.encode(formatSse(event)));
        }

        controller.enqueue(encoder.encode(formatSse(readyEvent)));
      },
      cancel: () => {
        if (activeClient) {
          this.#clients.delete(activeClient);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  }
}

function formatSse(event: TrussEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
