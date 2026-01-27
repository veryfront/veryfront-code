import { rendererLogger as logger } from "../../../utils/index.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../../observability/tracing/span-names.js";
import { getReactDOMServer } from "./server-loader.js";
async function streamToString(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
}
export async function renderToStringAdapter(element, options = {}) {
    const server = await getReactDOMServer();
    if (server.renderToReadableStream) {
        try {
            const stream = await withSpan(SpanNames.SSR_REACT_RENDER_TO_STREAM, () => server.renderToReadableStream(element, {
                onError: (error) => {
                    logger.error("SSR renderToReadableStream error", error);
                    options.onError?.(error);
                },
            }), { "ssr.method": "renderToReadableStream" });
            return await streamToString(stream);
        }
        catch (error) {
            logger.warn("SSR renderToReadableStream failed, falling back to renderToString", error);
        }
    }
    try {
        return (await withSpan(SpanNames.SSR_REACT_RENDER_TO_STRING, () => Promise.resolve(server.renderToString(element)), { "ssr.method": "renderToString" }));
    }
    catch (error) {
        logger.error("SSR renderToString failed", error);
        options.onError?.(error);
        throw error;
    }
}
export async function renderToStaticMarkupAdapter(element, options = {}) {
    const { renderToStaticMarkup } = await getReactDOMServer();
    try {
        return renderToStaticMarkup(element);
    }
    catch (error) {
        logger.error("SSR renderToStaticMarkup failed", error);
        options.onError?.(error);
        throw error;
    }
}
