import { serverLogger as logger } from "../../utils/index.js";
import { AgentStreamEventSchema } from "../streaming/index.js";
import { sendSSE } from "./sse-utils.js";
import { isDynamicTool, parseToolArgs } from "./tool-helpers.js";
import { MAX_STREAM_BUFFER_SIZE } from "./constants.js";
import { setActiveSpanAttributes, withSpan } from "../../observability/tracing/otlp-setup.js";
export function createStreamState() {
    return {
        accumulatedText: "",
        finishReason: null,
        toolCalls: new Map(),
    };
}
export function handleStreamEvent(event, state, controller, encoder, textPartId, callbacks) {
    switch (event.type) {
        case "content": {
            state.accumulatedText += event.content;
            sendSSE(controller, encoder, {
                type: "text-delta",
                id: textPartId,
                delta: event.content,
            });
            callbacks?.onChunk?.(event.content);
            return;
        }
        case "tool_call_start": {
            const id = event.toolCall?.id;
            if (!id)
                return;
            state.toolCalls.set(id, {
                id,
                name: event.toolCall.name,
                arguments: "",
            });
            const dynamic = isDynamicTool(event.toolCall.name);
            sendSSE(controller, encoder, {
                type: "tool-input-start",
                toolCallId: id,
                toolName: event.toolCall.name,
                ...(dynamic ? { dynamic: true } : {}),
            });
            return;
        }
        case "tool_call_delta": {
            const id = event.id;
            if (!id)
                return;
            const tc = state.toolCalls.get(id);
            if (!tc)
                return;
            tc.arguments += event.arguments;
            sendSSE(controller, encoder, {
                type: "tool-input-delta",
                toolCallId: id,
                inputTextDelta: event.arguments,
            });
            return;
        }
        case "tool_call_complete": {
            const id = event.toolCall?.id;
            if (!id)
                return;
            state.toolCalls.set(id, {
                id,
                name: event.toolCall.name,
                arguments: event.toolCall.arguments,
            });
            const dynamic = isDynamicTool(event.toolCall.name);
            const { args } = parseToolArgs(event.toolCall.arguments);
            sendSSE(controller, encoder, {
                type: "tool-input-available",
                toolCallId: id,
                toolName: event.toolCall.name,
                input: args,
                ...(dynamic ? { dynamic: true } : {}),
            });
            return;
        }
        case "finish":
            state.finishReason = event.finishReason;
            return;
        case "usage":
            if (event.usage)
                callbacks?.onUsage?.(event.usage);
            return;
    }
}
export function processStreamData(stream, state, controller, encoder, textPartId, callbacks) {
    return withSpan("agent.runtime.processStreamData", async () => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let partial = "";
        let eventCount = 0;
        const processLine = (line) => {
            try {
                const rawEvent = JSON.parse(line);
                const parseResult = AgentStreamEventSchema.safeParse(rawEvent);
                if (!parseResult.success) {
                    logger.warn("[AGENT] Invalid stream event received:", parseResult.error);
                    return;
                }
                eventCount++;
                handleStreamEvent(parseResult.data, state, controller, encoder, textPartId, callbacks);
            }
            catch (e) {
                logger.warn("[AGENT] Failed to parse stream line:", e);
            }
        };
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            partial += decoder.decode(value, { stream: true });
            if (partial.length > MAX_STREAM_BUFFER_SIZE) {
                logger.warn("[AGENT] Stream buffer exceeded max size, truncating");
                partial = partial.slice(-MAX_STREAM_BUFFER_SIZE / 2);
            }
            const segments = partial.split("\n");
            partial = segments.pop() ?? "";
            for (const line of segments) {
                if (!line.trim())
                    continue;
                processLine(line);
            }
        }
        if (partial.trim()) {
            try {
                const rawEvent = JSON.parse(partial);
                const parseResult = AgentStreamEventSchema.safeParse(rawEvent);
                if (parseResult.success) {
                    eventCount++;
                    handleStreamEvent(parseResult.data, state, controller, encoder, textPartId, callbacks);
                }
            }
            catch {
                // Ignore trailing partial
            }
        }
        setActiveSpanAttributes({
            "stream.event_count": eventCount,
            "stream.tool_calls": state.toolCalls.size,
            "stream.text_length": state.accumulatedText.length,
        });
    });
}
