import { z } from "zod";
import { getAgent } from "veryfront/agent";

// AI SDK v5 UIMessage format with parts array
// Supports text, tool-call, tool-result, and dynamic tool-* parts
const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(10000),
  state: z.string().optional(),
});

const toolCallPartSchema = z.object({
  type: z.literal("tool-call"),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.unknown(),
});

const toolResultPartSchema = z.object({
  type: z.literal("tool-result"),
  toolCallId: z.string(),
  result: z.unknown(),
});

// Dynamic tool part (e.g., tool-calculator, tool-search)
// These are UI-specific parts that include tool state
const dynamicToolPartSchema = z.object({
  type: z.string().startsWith("tool-"),
  toolCallId: z.string(),
  toolName: z.string(),
  state: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
}).passthrough();

// Union of all supported part types
const partSchema = z.union([
  textPartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
  dynamicToolPartSchema,
]);

const messageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  parts: z.array(partSchema).min(1),
});

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(100),
});

type ParsedMessage = z.infer<typeof messageSchema>;

/**
 * Transform UI messages to agent-compatible format.
 * AI SDK v5 UI bundles tool results in assistant message parts (output field),
 * but the agent runtime expects separate tool role messages.
 */
function transformUIMessages(messages: ParsedMessage[]): ParsedMessage[] {
  const result: ParsedMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      // Check for tool parts with output (completed tool calls)
      const toolPartsWithOutput = msg.parts.filter(
        (p): p is { type: string; toolCallId: string; toolName: string; output: unknown } =>
          typeof p === "object" &&
          p !== null &&
          "type" in p &&
          typeof p.type === "string" &&
          p.type.startsWith("tool-") &&
          p.type !== "tool-result" &&
          "output" in p &&
          p.output !== undefined
      );

      if (toolPartsWithOutput.length > 0) {
        // Add the assistant message (keep tool parts for args extraction)
        result.push(msg);

        // Add tool result messages for each completed tool call
        for (const toolPart of toolPartsWithOutput) {
          result.push({
            id: `tool_${toolPart.toolCallId}`,
            role: "tool",
            parts: [{
              type: "tool-result",
              toolCallId: toolPart.toolCallId,
              result: toolPart.output,
            }],
          });
        }
      } else {
        result.push(msg);
      }
    } else {
      result.push(msg);
    }
  }

  return result;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages: rawMessages } = chatRequestSchema.parse(body);

    // Transform UI format to agent-compatible format
    // AI SDK v5 UI bundles tool results in assistant parts (output field),
    // but the agent runtime expects separate tool role messages
    const messages = transformUIMessages(rawMessages);

    const agent = getAgent("assistant");
    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    // Clear server-side memory before each request
    // The client (useChat) manages full conversation history
    await agent.clearMemory();

    // In production, extract userId from session/cookie
    // For development, we use a default user
    const userId = "current-user";

    // Pass transformed messages to the agent
    const result = await agent.stream({
      messages,
      context: { userId },
    });
    return result.toDataStreamResponse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid request", details: error.errors },
        { status: 400 }
      );
    }
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
