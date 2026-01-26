import { z } from "zod";
export declare const AgentStreamEventSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"content">;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "content";
    content: string;
}, {
    type: "content";
    content: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"tool_call_start">;
    toolCall: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        id: string;
    }, {
        name: string;
        id: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "tool_call_start";
    toolCall: {
        name: string;
        id: string;
    };
}, {
    type: "tool_call_start";
    toolCall: {
        name: string;
        id: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"tool_call_delta">;
    id: z.ZodString;
    arguments: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "tool_call_delta";
    id: string;
    arguments: string;
}, {
    type: "tool_call_delta";
    id: string;
    arguments: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"tool_call_complete">;
    toolCall: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        id: string;
        arguments: string;
    }, {
        name: string;
        id: string;
        arguments: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "tool_call_complete";
    toolCall: {
        name: string;
        id: string;
        arguments: string;
    };
}, {
    type: "tool_call_complete";
    toolCall: {
        name: string;
        id: string;
        arguments: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"finish">;
    finishReason: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "finish";
    finishReason: string | null;
}, {
    type: "finish";
    finishReason: string | null;
}>, z.ZodObject<{
    type: z.ZodLiteral<"usage">;
    usage: z.ZodObject<{
        promptTokens: z.ZodOptional<z.ZodNumber>;
        completionTokens: z.ZodOptional<z.ZodNumber>;
        totalTokens: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        promptTokens?: number | undefined;
        completionTokens?: number | undefined;
        totalTokens?: number | undefined;
    }, {
        promptTokens?: number | undefined;
        completionTokens?: number | undefined;
        totalTokens?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "usage";
    usage: {
        promptTokens?: number | undefined;
        completionTokens?: number | undefined;
        totalTokens?: number | undefined;
    };
}, {
    type: "usage";
    usage: {
        promptTokens?: number | undefined;
        completionTokens?: number | undefined;
        totalTokens?: number | undefined;
    };
}>]>;
export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;
export declare class StreamEventEmitter {
    private controller;
    private encoder;
    constructor(controller: ReadableStreamDefaultController);
    emit(event: Record<string, unknown>): void;
    private emitToolEvent;
    emitStart(messageId: string): void;
    emitTextStart(id: string): void;
    emitTextDelta(id: string, delta: string): void;
    emitTextEnd(id: string): void;
    emitToolInputStart(toolCallId: string, toolName: string, dynamic?: boolean): void;
    emitToolInputDelta(toolCallId: string, inputTextDelta: string): void;
    emitToolInputAvailable(toolCallId: string, toolName: string, input: Record<string, unknown>, dynamic?: boolean): void;
    emitToolOutputAvailable(toolCallId: string, output: unknown, dynamic?: boolean): void;
    emitToolOutputError(toolCallId: string, errorText: string, dynamic?: boolean): void;
    emitToolInputError(toolCallId: string, errorText: string, dynamic?: boolean): void;
    emitFinish(): void;
    emitError(error: string): void;
    emitStartStep(): void;
    emitFinishStep(): void;
}
//# sourceMappingURL=stream-events.d.ts.map