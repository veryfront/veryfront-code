import { BaseProvider, mapFinishReason } from "./base.js";
import { createError, toError } from "../errors/veryfront-error.js";
function isOSeriesModel(model) {
    return model.startsWith("o1") || model.startsWith("o3");
}
export class OpenAIProvider extends BaseProvider {
    name = "openai";
    constructor(config) {
        super(config);
    }
    getHeaders() {
        const { apiKey, organizationId } = this.config;
        return {
            Authorization: `Bearer ${apiKey}`,
            ...(organizationId ? { "OpenAI-Organization": organizationId } : {}),
        };
    }
    getEndpoint(path) {
        const { baseURL } = this.config;
        return `${baseURL ?? "https://api.openai.com/v1"}${path}`;
    }
    transformRequest(request) {
        const isReasoning = isOSeriesModel(request.model);
        const body = {
            model: request.model,
            messages: this.formatMessages(request.messages, request.system),
            stream: request.stream ?? false,
        };
        if (request.maxTokens) {
            if (isReasoning)
                body.max_completion_tokens = request.maxTokens;
            else
                body.max_tokens = request.maxTokens;
        }
        if (!isReasoning) {
            if (request.temperature !== undefined)
                body.temperature = request.temperature;
            if (request.topP !== undefined)
                body.top_p = request.topP;
        }
        if (request.tools?.length) {
            body.tools = request.tools.map((tool) => ({
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            }));
            if (!isReasoning)
                body.parallel_tool_calls = false;
        }
        if (isReasoning && request.reasoning?.effort) {
            body.reasoning_effort = request.reasoning.effort;
        }
        return body;
    }
    transformResponse(response) {
        if (!response || typeof response !== "object") {
            throw toError(createError({
                type: "agent",
                message: "OpenAI: Invalid response format - expected object",
            }));
        }
        const data = response;
        const choice = data.choices?.[0];
        if (!choice?.message) {
            throw toError(createError({
                type: "agent",
                message: "OpenAI: Response missing choices array",
            }));
        }
        const toolCalls = choice.message.tool_calls?.map((tc) => {
            try {
                return {
                    id: tc.id,
                    name: tc.function.name,
                    arguments: JSON.parse(tc.function.arguments),
                };
            }
            catch (error) {
                throw toError(createError({
                    type: "agent",
                    message: `OpenAI: Invalid tool call arguments JSON for ${tc.function.name}: ${error instanceof Error ? error.message : String(error)}`,
                }));
            }
        });
        return {
            text: choice.message.content ?? "",
            toolCalls,
            usage: {
                promptTokens: data.usage?.prompt_tokens ?? 0,
                completionTokens: data.usage?.completion_tokens ?? 0,
                totalTokens: data.usage?.total_tokens ?? 0,
            },
            finishReason: mapFinishReason(choice.finish_reason ?? "stop"),
        };
    }
    formatMessages(messages, system) {
        const formattedMessages = messages.map((msg) => {
            if (msg.tool_call_id) {
                return {
                    role: "tool",
                    tool_call_id: msg.tool_call_id,
                    content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
                };
            }
            if (msg.role === "assistant" && msg.tool_calls) {
                return {
                    role: "assistant",
                    content: msg.content || null,
                    tool_calls: msg.tool_calls.map((tc) => ({
                        id: tc.id,
                        type: tc.type || "function",
                        function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments,
                        },
                    })),
                };
            }
            return { role: msg.role, content: msg.content };
        });
        if (!system)
            return formattedMessages;
        return [{ role: "system", content: system }, ...formattedMessages];
    }
}
