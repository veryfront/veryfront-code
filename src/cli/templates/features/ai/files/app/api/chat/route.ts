import { z } from "zod";
import { getAgent } from "veryfront/agent";

const partSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string().max(10000),
  }),
  z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string(),
    result: z.unknown(),
  }),
]);

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        role: z.enum(["user", "assistant", "system", "tool"]),
        parts: z.array(partSchema).min(1),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { messages } = chatRequestSchema.parse(body);

    const agent = getAgent("assistant");
    if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });

    const result = await agent.stream({ messages });
    return result.toDataStreamResponse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid request", details: error.errors },
        { status: 400 },
      );
    }

    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
