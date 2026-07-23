import { serverLogger } from "#veryfront/utils";
import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import { normalizeComponentRoute } from "./component-resolver.ts";
import type { RenderHandler } from "./render-handler.ts";
import type { StreamSlot } from "./types.ts";

const logger = serverLogger.component("rsc");

export class StreamHandler {
  constructor(private renderHandler: RenderHandler) {}

  async handle(pathname: string, searchParams: URLSearchParams): Promise<Response> {
    const requestedPage = searchParams.get("page") ?? pathname ?? "/";
    if (normalizeComponentRoute(requestedPage) === null) {
      return jsonErrorResponse(HttpStatus.BAD_REQUEST, "Invalid page route");
    }

    const renderResponse = await this.renderHandler.handle(requestedPage, searchParams);
    if (!renderResponse.ok) {
      return renderResponse;
    }

    const html = await this.readRenderedHtml(renderResponse);
    if (html === null) {
      return jsonErrorResponse(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "Invalid render response",
        { headers: { "cache-control": "no-store" } },
      );
    }

    const slot: StreamSlot = { type: "slot", id: "root", html };

    return new Response(`${JSON.stringify(slot)}\n`, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  }

  private async readRenderedHtml(response: Response): Promise<string | null> {
    try {
      const payload: unknown = await response.json();
      if (
        payload === null || typeof payload !== "object" ||
        typeof (payload as { html?: unknown }).html !== "string"
      ) {
        logger.warn("render response is missing HTML");
        return null;
      }

      return (payload as { html: string }).html;
    } catch (error) {
      logger.warn("failed to parse render response", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return null;
    }
  }
}
