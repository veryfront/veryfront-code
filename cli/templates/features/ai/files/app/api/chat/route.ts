import { defineSchema } from "veryfront/schemas";
import { getAgent } from "veryfront/agent";

const getPartSchema = defineSchema((v) =>
  v.union([
    v.object({
      type: v.literal("text"),
      text: v.string().max(10000),
    }),
    v.object({
      type: v.literal("tool-call"),
      toolCallId: v.string(),
      toolName: v.string(),
      args: v.unknown(),
    }),
    v.object({
      type: v.literal("tool-result"),
      toolCallId: v.string(),
      result: v.unknown(),
    }),
  ])
);

const getChatRequestSchema = defineSchema((v) =>
  v.object({
    messages: v
      .array(
        v.object({
          id: v.string().optional(),
          role: v.enum(["user", "assistant", "system", "tool"]),
          parts: v.array(getPartSchema()).min(1),
        }),
      )
      .min(1)
      .max(100),
  })
);

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { messages } = getChatRequestSchema().parse(body);

    const agent = getAgent("assistant");
    if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });

    const result = await agent.stream({ messages });
    return result.toDataStreamResponse();
  } catch (error) {
    if (
      error instanceof Error && "issues" in error &&
      Array.isArray((error as Record<string, unknown>).issues)
    ) {
      return Response.json(
        { error: "Invalid request", details: (error as Record<string, unknown>).issues },
        { status: 400 },
      );
    }

    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
