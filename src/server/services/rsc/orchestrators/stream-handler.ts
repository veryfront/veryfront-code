import { serverLogger, sleep } from "#veryfront/utils";
import type { RSCPayload } from "#veryfront/rendering/rsc/types.ts";
import type { RenderHandler } from "./render-handler.ts";
import type { StreamSlot } from "./types.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";

const logger = serverLogger.component("rsc");

const STREAM_DELAY_MS = 30;
const FALLBACK_HTML = "<div>OK</div>";

export class StreamHandler {
  constructor(private renderHandler: RenderHandler) {}

  async handle(
    pathname: string,
    searchParams: URLSearchParams,
    request?: Request,
  ): Promise<Response> {
    const finalPayload = await this.getFinalPayload(pathname, searchParams, request);
    const stream = this.createStream(finalPayload.html, searchParams);

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache",
        vary: RSC_DEPENDENCY_PINNING_HEADER,
        ...(finalPayload.dependencyPinningCacheKey
          ? {
            [RSC_DEPENDENCY_PINNING_HEADER]: finalPayload.dependencyPinningCacheKey,
          }
          : {}),
      },
    });
  }

  private async getFinalPayload(
    pathname: string,
    searchParams: URLSearchParams,
    request?: Request,
  ): Promise<Pick<RSCPayload, "html" | "dependencyPinningCacheKey">> {
    const pageParam = searchParams.get("page") ?? pathname ?? "/";
    const response = await this.renderHandler.handle(pageParam, searchParams, request);

    if (!response.ok) return { html: FALLBACK_HTML };

    try {
      const payload = (await response.json()) as RSCPayload;
      return {
        html: payload.html ?? FALLBACK_HTML,
        dependencyPinningCacheKey: payload.dependencyPinningCacheKey,
      };
    } catch (error) {
      logger.warn("[dev] failed to parse final HTML payload", error);
      return { html: FALLBACK_HTML };
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
          enqueueSlot(controller, encoder, { type: "slot", id: "root", html: "<p>Loading...</p>" });
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

          enqueueSlot(controller, encoder, { type: "slot", id: "root", html: finalHtml });

          controller.close();
        } catch (error) {
          logger.warn("[dev] stream handler error", error);
          controller.error(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
  }
}

function enqueueSlot(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  slot: StreamSlot,
): void {
  controller.enqueue(encoder.encode(`${JSON.stringify(slot)}\n`));
}
