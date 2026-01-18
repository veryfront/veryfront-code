import { z } from "zod";
import { getAgent } from "veryfront/agent";

// AI SDK v5 UIMessage format with parts array
// Supports text, tool-call, and tool-result parts for full conversation history
const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(10000),
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

// Union of all supported part types
const partSchema = z.union([
  textPartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
]);

const messageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  parts: z.array(partSchema).min(1),
});

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages } = chatRequestSchema.parse(body);

    const agent = getAgent("assistant");
    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    // Pass v5 format messages directly to the agent
    const result = await agent.stream({ messages });
    return result.toDataStreamResponse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid request", details: error.errors },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
