/**
 * SSR Renderer
 *
 * Handles server-side rendering of React elements using both streaming and string methods.
 * Provides React 18/19 streaming support with fallback to string rendering.
 */
import { ErrorCode, VeryfrontError } from "../errors/index.js";
import { getReactVersionInfo, renderToStreamAdapter, renderToStringAdapter, } from "../react/index.js";
import { isCompiledBinary, rendererLogger as logger } from "../utils/index.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
import { SpanNames } from "../observability/tracing/span-names.js";
import { streamToString } from "./utils/index.js";
import { setupSSRGlobals } from "./ssr-globals.js";
/** Check if React version supports streaming/concurrent features (React 18+) */
function supportsStreamingSSR(versionInfo) {
    return versionInfo.isReact18 || versionInfo.isReact19;
}
/**
 * Convert Node.js pipeable stream to string
 *
 * renderToPipeableStream returns { pipe, abort } instead of a ReadableStream.
 * This function creates a PassThrough stream, pipes the content to it,
 * and collects the output as a string.
 */
async function pipeToString(pipeFn) {
    const { PassThrough } = await import("node:stream");
    const { Buffer } = await import("node:buffer");
    return await new Promise((resolve, reject) => {
        const chunks = [];
        const passThrough = new PassThrough();
        passThrough.on("data", (chunk) => chunks.push(chunk));
        passThrough.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        passThrough.on("error", (err) => reject(err));
        try {
            pipeFn(passThrough);
        }
        catch (error) {
            reject(error);
        }
    });
}
/**
 * Convert Node.js pipeable stream to Web ReadableStream for true streaming SSR
 *
 * This enables immediate TTFB by returning a ReadableStream that can be
 * piped to the HTTP response before React finishes rendering.
 */
function pipeToReadableStream(pipeFn) {
    return new ReadableStream({
        async start(controller) {
            const { PassThrough } = await import("node:stream");
            const passThrough = new PassThrough();
            passThrough.on("data", (chunk) => {
                controller.enqueue(new Uint8Array(chunk));
            });
            passThrough.on("end", () => controller.close());
            passThrough.on("error", (err) => controller.error(err));
            try {
                pipeFn(passThrough);
            }
            catch (error) {
                controller.error(error);
            }
        },
    });
}
export class SSRRenderer {
    mode;
    adapter;
    projectDir;
    versionInfo = null;
    constructor(mode, adapter, projectDir) {
        this.mode = mode;
        this.adapter = adapter;
        this.projectDir = projectDir;
    }
    async getVersionInfo() {
        if (this.versionInfo)
            return this.versionInfo;
        if (this.projectDir) {
            const { getReactVersionInfoForProject } = await import("../react/index.js");
            this.versionInfo = await getReactVersionInfoForProject(this.projectDir);
            return this.versionInfo;
        }
        this.versionInfo = getReactVersionInfo();
        return this.versionInfo;
    }
    async renderToHTML(pageElement, options) {
        setupSSRGlobals();
        const versionInfo = await this.getVersionInfo();
        const wantsStreamingMode = this.mode === "production" || options.wantsStream;
        const compiledBinary = isCompiledBinary();
        const useStreaming = !compiledBinary &&
            wantsStreamingMode &&
            supportsStreamingSSR(versionInfo);
        if (compiledBinary && wantsStreamingMode) {
            logger.debug("Streaming SSR disabled in compiled binary (using string rendering)", {
                reactVersion: versionInfo.version,
                reason: "Workers with blob URLs not supported in deno compile binaries",
            });
        }
        if (!useStreaming) {
            logger.debug("Using string SSR", {
                mode: this.mode,
                reactVersion: versionInfo.version,
            });
            const html = await withSpan(SpanNames.SSR_REACT_RENDER, () => renderToStringAdapter(pageElement), {
                "ssr.method": "string",
                "ssr.react_version": versionInfo.version,
            });
            return { html, stream: null };
        }
        logger.debug("Rendering via streaming adapter", {
            reactVersion: versionInfo.version,
            delivery: options.wantsStream ? "stream" : "string",
        });
        const renderResult = await withSpan(SpanNames.SSR_REACT_RENDER, () => renderToStreamAdapter(pageElement, {
            identifierPrefix: "vf",
        }), {
            "ssr.method": "streaming",
            "ssr.react_version": versionInfo.version,
            "ssr.wants_stream": options.wantsStream,
        });
        if (renderResult.stream) {
            if (options.wantsStream) {
                logger.debug("True streaming SSR - returning stream without buffering");
                return { html: "", stream: renderResult.stream };
            }
            const html = await streamToString(renderResult.stream);
            if (options.debugMode) {
                logger.debug("Streaming SSR completed (buffered)", { htmlLength: html.length });
            }
            return { html, stream: null };
        }
        if (renderResult.pipe) {
            if (options.wantsStream) {
                logger.debug("Converting pipeable stream to ReadableStream for true streaming");
                return { html: "", stream: pipeToReadableStream(renderResult.pipe) };
            }
            logger.debug("Converting pipeable stream to string (Node.js renderToPipeableStream)");
            const html = await pipeToString(renderResult.pipe);
            if (options.debugMode) {
                logger.debug("Pipeable SSR completed", { htmlLength: html.length });
            }
            return { html, stream: null };
        }
        if (renderResult.html) {
            return { html: renderResult.html, stream: null };
        }
        throw new VeryfrontError("SSR failed - no output", ErrorCode.RENDER_ERROR);
    }
    getRenderingStrategy() {
        const versionInfo = getReactVersionInfo();
        const hasStreamingSupport = supportsStreamingSSR(versionInfo);
        const useStreaming = this.mode === "production" && hasStreamingSupport;
        return {
            method: useStreaming ? "streaming" : "string",
            reactVersion: versionInfo.version,
            features: {
                streaming: hasStreamingSupport,
                suspense: hasStreamingSupport,
                concurrent: hasStreamingSupport,
            },
        };
    }
    supportsStreaming() {
        return supportsStreamingSSR(getReactVersionInfo());
    }
}
