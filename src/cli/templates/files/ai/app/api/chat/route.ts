import { z } from "zod";
import { getAgent } from "veryfront/ai";

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(10000),
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

    const userId = "current-user";

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
