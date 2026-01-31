import { z } from "zod";
import { getAgent } from "veryfront/agent";

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

const dynamicToolPartSchema = z
  .object({
    type: z.string().startsWith("tool-"),
    toolCallId: z.string(),
    toolName: z.string(),
    state: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
  })
  .passthrough();

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

type ToolPartWithOutput = {
  type: string;
  toolCallId: string;
  toolName: string;
  output: unknown;
};

function isToolPartWithOutput(part: unknown): part is ToolPartWithOutput {
  if (!part || typeof part !== "object") return false;

  const p = part as Record<string, unknown>;
  const type = p.type;

  if (typeof type !== "string") return false;
  if (!type.startsWith("tool-") || type === "tool-result") return false;

  return p.output !== undefined;
}

function transformUIMessages(messages: ParsedMessage[]): ParsedMessage[] {
  const result: ParsedMessage[] = [];

  for (const msg of messages) {
    result.push(msg);

    if (msg.role !== "assistant") continue;

    for (const toolPart of msg.parts.filter(isToolPartWithOutput)) {
      result.push({
        id: `tool_${toolPart.toolCallId}`,
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: toolPart.toolCallId,
            result: toolPart.output,
          },
        ],
      });
    }
  }

  return result;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { messages: rawMessages } = chatRequestSchema.parse(body);
    const messages = transformUIMessages(rawMessages);

    const agent = getAgent("assistant");
    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    await agent.clearMemory();

    const userId = "current-user";
    const result = await agent.stream({ messages, context: { userId } });

    return result.toDataStreamResponse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid request", details: error.errors }, { status: 400 });
    }

    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
