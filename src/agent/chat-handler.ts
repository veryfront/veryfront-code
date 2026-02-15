import { z } from "zod";
import { getAgent } from "./composition/index.ts";
import type { Message } from "./types.ts";

// ---------------------------------------------------------------------------
// Zod schemas for validating AI SDK v5 chat UI messages
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Message transformation
// ---------------------------------------------------------------------------

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

/**
 * The chat UI bundles tool results inside assistant message parts (output field).
 * The agent runtime expects them as separate tool-role messages — extract them.
 */
function transformUIMessages(messages: ParsedMessage[]): Message[] {
  const result: Array<{ id: string; role: string; parts: unknown[] }> = [];
  let counter = 0;

  for (const msg of messages) {
    result.push({
      id: msg.id ?? `msg_${counter++}`,
      role: msg.role,
      parts: msg.parts,
    });

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

  // UI schema is more permissive (optional id, extra fields) — safe to cast
  // after normalization since Zod already validated the request boundary.
  return result as unknown as Message[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ChatHandlerOptions {
  /** Override context passed to agent.stream(). Default: `{ userId: "current-user" }` */
  context?:
    | Record<string, unknown>
    | ((
      request: Request,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>);
}

/**
 * Create a POST handler for a chat API route.
 *
 * Encapsulates request validation, message transformation, agent streaming,
 * and error handling so that template routes stay one-liners.
 *
 * @example
 * ```ts
 * import { createChatHandler } from "veryfront/agent";
 * export const POST = createChatHandler("assistant");
 * ```
 */
export function createChatHandler(
  agentId: string,
  options?: ChatHandlerOptions,
) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const body = await request.json();
      const { messages: rawMessages } = chatRequestSchema.parse(body);

      const agent = getAgent(agentId);
      if (!agent) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
      }

      // Clear server-side memory before each request —
      // the client (useChat) manages full conversation history
      await agent.clearMemory();

      const context = typeof options?.context === "function"
        ? await options.context(request)
        : options?.context ?? { userId: "current-user" };

      const result = await agent.stream({
        messages: transformUIMessages(rawMessages),
        context,
      });

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
  };
}
