import { z } from "zod";
import { getAgent } from "veryfront/ai";

// AI SDK v5 UIMessage format with parts array
const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(10000),
});

const messageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(textPartSchema).min(1),
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
