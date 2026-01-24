import { serverLogger as logger } from "#veryfront/utils";
import type { RSCPayload } from "#veryfront/rendering/rsc/types.ts";
import type { RenderHandler } from "./render-handler.ts";
import type { StreamSlot } from "./types.ts";

const STREAM_DELAY_MS = 30;
const FALLBACK_HTML = "<div>OK</div>";

export class StreamHandler {
  constructor(private renderHandler: RenderHandler) {}

  async handle(pathname: string, searchParams: URLSearchParams): Promise<Response> {
    const finalHtml = await this.getFinalHtml(pathname, searchParams);
    const stream = this.createStream(finalHtml, searchParams);

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  }

  private async getFinalHtml(pathname: string, searchParams: URLSearchParams): Promise<string> {
    const pageParam = searchParams.get("page") ?? pathname ?? "/";
    const response = await this.renderHandler.handle(pageParam, searchParams);

    if (!response.ok) return FALLBACK_HTML;

    try {
      const payload: RSCPayload = await response.json();
      return payload.html ?? FALLBACK_HTML;
    } catch (error) {
      logger.warn("[RSC][dev] failed to parse final HTML payload", error);
      return FALLBACK_HTML;
    }
  }

  private createStream(
    finalHtml: string,
    searchParams: URLSearchParams,
  ): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          enqueueSlot(controller, encoder, {
            type: "slot",
            id: "root",
            html: "<p>Loading...</p>",
          });

          enqueueSlot(controller, encoder, {
            type: "slot",
            id: "sidebar",
            html: "<p>Sidebar loading…</p>",
          });

          await sleep(STREAM_DELAY_MS);

          enqueueSlot(controller, encoder, {
            type: "slot",
            id: "sidebar",
            html: "<aside><ul><li>A</li><li>B</li></ul></aside>",
          });

          if (searchParams.get("bad") === "1") {
            controller.enqueue(encoder.encode("MALFORMED_JSON\n"));
          }

          await sleep(STREAM_DELAY_MS);

          enqueueSlot(controller, encoder, {
            type: "slot",
            id: "root",
            html: finalHtml,
          });

          controller.close();
        } catch (error) {
          logger.warn("[RSC][dev] stream handler error", error);
          controller.error(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueSlot(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  slot: StreamSlot,
): void {
  controller.enqueue(encoder.encode(`${JSON.stringify(slot)}\n`));
}
