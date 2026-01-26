import * as dntShim from "../../_dnt.shims.js";
import { AgentRuntime } from "./runtime/index.js";
import { detectPlatform, validatePlatformCompatibility } from "../platform/core-platform.js";
import { registerTool } from "../mcp/index.js";
import { agentRegistry } from "./composition/index.js";
import { agentLogger } from "../utils/logger/logger.js";
import { createError, toError } from "../errors/veryfront-error.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
const STREAMING_HEADERS = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "x-vercel-ai-ui-message-stream": "v1",
};
function createAgentStreamResult(stream) {
    return {
        toDataStreamResponse(options) {
            return new dntShim.Response(stream, {
                status: options?.status ?? 200,
                statusText: options?.statusText,
                headers: { ...STREAMING_HEADERS, ...options?.headers },
            });
        },
    };
}
export function agent(config) {
    if (typeof config.id === "string" && config.id.trim().length === 0) {
        throw toError(createError({
            type: "agent",
            message: "Agent id cannot be empty.",
        }));
    }
    const id = config.id ?? generateAgentId();
    if (config.tools && config.tools !== true) {
        for (const [name, entry] of Object.entries(config.tools)) {
            if (!entry || typeof entry !== "object")
                continue;
            const normalizedTool = entry.id === name ? entry : { ...entry, id: name };
            registerTool(normalizedTool.id, normalizedTool);
            config.tools[name] = normalizedTool;
        }
    }
    const platform = detectPlatform();
    const compatibility = validatePlatformCompatibility({
        maxSteps: config.maxSteps,
        streaming: config.streaming,
        requiresFileSystem: false,
        requiresMCP: false,
    }, platform);
    if (!compatibility.compatible) {
        throw toError(createError({
            type: "agent",
            message: `Agent "${id}" is not compatible with current platform:\n${compatibility.errors.join("\n")}`,
        }));
    }
    if (compatibility.warnings.length) {
        agentLogger.warn(`Agent "${id}" warnings:\n${compatibility.warnings.join("\n")}`);
    }
    const runtime = new AgentRuntime(id, config);
    const agentInstance = {
        id,
        config,
        generate(input) {
            return withSpan("agent.factory.generate", () => runtime.generate(input.input, input.context), { "agent.id": id });
        },
        stream(input) {
            return withSpan("agent.factory.stream", async () => {
                const inputMessages = input.input
                    ? [
                        {
                            id: `msg_${Date.now()}`,
                            role: "user",
                            parts: [{ type: "text", text: input.input }],
                        },
                    ]
                    : (input.messages ?? []);
                const stream = await runtime.stream(inputMessages, input.context, {
                    onToolCall: input.onToolCall,
                    onChunk: input.onChunk,
                });
                return createAgentStreamResult(stream);
            }, { "agent.id": id, "agent.input_type": input.input ? "string" : "messages" });
        },
        respond(request) {
            return withSpan("agent.factory.respond", async () => {
                const body = await request
                    .json();
                const messages = body.messages ?? [];
                const stream = await runtime.stream(messages, body.context);
                return new dntShim.Response(stream, { headers: STREAMING_HEADERS });
            }, { "agent.id": id });
        },
        getMemory() {
            return runtime.getMemory();
        },
        getMemoryStats() {
            return runtime.getMemoryStats();
        },
        clearMemory() {
            return runtime.clearMemory();
        },
    };
    agentRegistry.register(id, agentInstance);
    return agentInstance;
}
let agentIdCounter = 0;
function generateAgentId() {
    return `agent_${Date.now()}_${agentIdCounter++}`;
}
