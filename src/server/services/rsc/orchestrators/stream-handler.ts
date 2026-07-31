import type { RSCPayload } from "#veryfront/rendering/rsc/types.ts";
import type { RenderHandler } from "./render-handler.ts";
import type { StreamSlot } from "./types.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";

const STREAM_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-cache",
} as const;

function invalidRenderPayloadResponse(): Response {
  return new Response("Invalid RSC render payload", {
    status: 500,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      vary: RSC_DEPENDENCY_PINNING_HEADER,
    },
  });
}

export class StreamHandler {
  constructor(private renderHandler: RenderHandler) {}

  async handle(
    pathname: string,
    searchParams: URLSearchParams,
    request?: Request,
  ): Promise<Response> {
    const page = searchParams.get("page") ?? pathname;
    const renderResponse = await this.renderHandler.handle(page, searchParams, request);
    if (!renderResponse.ok) return renderResponse;

    let payload: RSCPayload;
    try {
      payload = await renderResponse.json() as RSCPayload;
    } catch {
      return invalidRenderPayloadResponse();
    }

    if (typeof payload !== "object" || payload === null || typeof payload.html !== "string") {
      return invalidRenderPayloadResponse();
    }

    const stream = this.createStream(payload.html);

    return new Response(stream, {
      headers: {
        ...STREAM_HEADERS,
        vary: RSC_DEPENDENCY_PINNING_HEADER,
        ...(payload.dependencyPinningCacheKey?.startsWith("on:")
          ? {
            [RSC_DEPENDENCY_PINNING_HEADER]: payload.dependencyPinningCacheKey,
          }
          : {}),
      },
    });
  }

  private createStream(finalHtml: string): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        enqueueSlot(controller, encoder, { type: "slot", id: "root", html: finalHtml });
        controller.close();
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
