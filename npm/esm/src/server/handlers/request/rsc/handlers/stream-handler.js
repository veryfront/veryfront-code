import * as dntShim from "../../../../../../_dnt.shims.js";
import { serverLogger as logger } from "../../../../../utils/index.js";
const STREAM_DELAY_MS = 30;
const FALLBACK_HTML = "<div>OK</div>";
export class StreamHandler {
    renderHandler;
    constructor(renderHandler) {
        this.renderHandler = renderHandler;
    }
    async handle(pathname, searchParams) {
        const finalHtml = await this.getFinalHtml(pathname, searchParams);
        const stream = this.createStream(finalHtml, searchParams);
        return new dntShim.Response(stream, {
            headers: {
                "content-type": "application/x-ndjson; charset=utf-8",
                "cache-control": "no-cache",
            },
        });
    }
    async getFinalHtml(pathname, searchParams) {
        const pageParam = searchParams.get("page") ?? pathname ?? "/";
        const response = await this.renderHandler.handle(pageParam, searchParams);
        if (!response.ok)
            return FALLBACK_HTML;
        try {
            const payload = await response.json();
            return payload.html ?? FALLBACK_HTML;
        }
        catch (error) {
            logger.warn("[RSC][dev] failed to parse final HTML payload", error);
            return FALLBACK_HTML;
        }
    }
    createStream(finalHtml, searchParams) {
        return new ReadableStream({
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
                }
                catch (error) {
                    logger.warn("[RSC][dev] stream handler error", error);
                    controller.error(error instanceof Error ? error : new Error(String(error)));
                }
            },
        });
    }
}
function sleep(ms) {
    return new Promise((resolve) => dntShim.setTimeout(resolve, ms));
}
function enqueueSlot(controller, encoder, slot) {
    controller.enqueue(encoder.encode(`${JSON.stringify(slot)}\n`));
}
