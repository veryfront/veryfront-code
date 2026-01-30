import * as dntShim from "../../../_dnt.shims.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../observability/tracing/span-names.js";
import { computeHash } from "../utils/index.js";
import { runWithHeadCollector } from "../../react/head-collector.js";
function getElementTypeName(el) {
    if (!el?.type)
        return "unknown";
    if (typeof el.type === "string")
        return el.type;
    const type = el.type;
    return type.name || type.displayName || "Component";
}
export class SSROrchestrator {
    config;
    constructor(config) {
        this.config = config;
    }
    async performSSRRendering(pageElement, generationContext, options) {
        logger.debug("[SSROrchestrator] performSSRRendering called", {
            elementType: getElementTypeName(pageElement),
            hasChildren: !!pageElement?.props?.children,
        });
        const validatedElement = this.config.elementValidator.ensureValidReactElement(pageElement, this.config.debugMode);
        logger.debug("[SSROrchestrator] Element validated", {
            validatedType: getElementTypeName(validatedElement),
        });
        const wantsStream = options?.delivery === "stream";
        // Use AsyncLocalStorage-based head collection for multi-tenant safety
        const { result: renderResult, head: collectedHead } = await runWithHeadCollector(() => withSpan(SpanNames.SSR_ORCHESTRATOR_RENDER, () => this.config.ssrRenderer.renderToHTML(validatedElement, {
            mode: this.config.mode,
            wantsStream,
            debugMode: this.config.debugMode,
        }), {
            "ssr.wants_stream": wantsStream,
            "ssr.mode": this.config.mode,
        }));
        const { html, stream } = renderResult;
        const mergedOptions = {
            ...generationContext.options,
            ...options,
            props: {
                ...generationContext.options?.props,
                ...options?.props,
            },
        };
        if (stream && wantsStream) {
            const ssrHash = html ? await computeHash(html) : `stream-${Date.now()}`;
            logger.debug("[SSROrchestrator] True streaming mode - sending HTML shell immediately", {
                hasBufferedHtml: !!html,
                ssrHash,
            });
            const finalStream = await this.config.htmlGenerator.generateHTMLStream(stream, {
                ...generationContext,
                ssrHash,
                options: mergedOptions,
                collectedHead,
            });
            return { fullHtml: html, finalStream, ssrHash };
        }
        const ssrHash = await withSpan(SpanNames.SSR_CONTENT_HASH, () => computeHash(html), { "ssr.html_length": html.length });
        const fullHtml = await withSpan(SpanNames.SSR_HTML_GENERATE, () => this.config.htmlGenerator.generateFullHTML({
            ...generationContext,
            html,
            ssrHash,
            options: mergedOptions,
            collectedHead,
        }), { "ssr.hash": ssrHash });
        const finalStream = wantsStream ? this.createStream(fullHtml) : null;
        return { fullHtml, finalStream, ssrHash };
    }
    createStream(html) {
        try {
            return new dntShim.Response(html).body ?? null;
        }
        catch (error) {
            logger.error("Failed to create stream from HTML:", error);
            throw toError(createError({
                type: "render",
                message: `Unable to create response stream: ${error instanceof Error ? error.message : String(error)}`,
            }));
        }
    }
}
