import { z } from "zod";
import { getAgent } from "./composition/index.ts";
import type { Message } from "./types.ts";
import { fromError } from "#veryfront/errors/veryfront-error.ts";
import { DEFAULT_LOCAL_MODEL } from "../provider/local/model-catalog.ts";

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
type ParsedTextPart = z.infer<typeof textPartSchema>;

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

function isTextPart(part: unknown): part is ParsedTextPart {
  return typeof part === "object" && part !== null && (part as { type?: string }).type === "text";
}

function extractLastUserText(messages: ParsedMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;

    const text = message.parts
      .filter(isTextPart)
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (text.length > 0) return text;
  }

  return "";
}

function isResponseLike(value: unknown): value is Response {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Response).status === "number" &&
    typeof (value as Response).headers === "object" &&
    typeof (value as Response).bodyUsed === "boolean"
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ChatHandlerMessageInput = Omit<Message, "id"> & { id?: string };

export interface ChatHandlerBeforeStreamContext {
  request: Request;
  messages: Message[];
  context: Record<string, unknown>;
  lastUserText: string;
}

export interface ChatHandlerBeforeStreamResult {
  prepend?: ChatHandlerMessageInput[];
  append?: ChatHandlerMessageInput[];
  replaceMessages?: ChatHandlerMessageInput[];
  context?: Record<string, unknown>;
}

export type ChatHandlerBeforeStream = (
  input: ChatHandlerBeforeStreamContext,
) =>
  | void
  | Response
  | ChatHandlerBeforeStreamResult
  | Promise<void | Response | ChatHandlerBeforeStreamResult>;

function normalizeHookMessages(
  messages: ChatHandlerMessageInput[] | undefined,
  prefix: string,
  idCounter: { value: number },
): Message[] {
  if (!messages || messages.length === 0) return [];

  return messages.map((message) => ({
    ...message,
    id: message.id ?? `${prefix}_${idCounter.value++}`,
  })) as Message[];
}

function applyBeforeStreamResult(
  baseMessages: Message[],
  result: ChatHandlerBeforeStreamResult | undefined,
): Message[] {
  if (!result) return baseMessages;

  const idCounter = { value: 0 };
  const coreMessages = result.replaceMessages
    ? normalizeHookMessages(result.replaceMessages, "replace", idCounter)
    : baseMessages;

  return [
    ...normalizeHookMessages(result.prepend, "prepend", idCounter),
    ...coreMessages,
    ...normalizeHookMessages(result.append, "append", idCounter),
  ];
}

/** Options for `createChatHandler` — customize the context passed to the agent. */
export interface ChatHandlerOptions {
  /** Override context passed to agent.stream(). Default: `{ userId: "current-user" }` */
  context?:
    | Record<string, unknown>
    | ((
      request: Request,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>);
  /**
   * Hook to customize validated messages/context right before `agent.stream()`.
   * Return `Response` to short-circuit (e.g. auth/rate limit).
   */
  beforeStream?: ChatHandlerBeforeStream;
}

/**
 * Extract the raw Request from either a raw Request or a Pages Router APIContext.
 * Pages Router handlers receive `(ctx)` where `ctx.request` is the Request.
 * App Router handlers receive `(request, context)` where `request` IS the Request.
 */
function isRequest(obj: unknown): obj is Request {
  // Use duck-typing instead of instanceof because dnt replaces `Request`
  // with undici's version, which doesn't match Deno's native Request.
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as Request).json === "function" &&
    typeof (obj as Request).url === "string" &&
    typeof (obj as Request).method === "string"
  );
}

function extractRequest(requestOrCtx: unknown): Request {
  if (isRequest(requestOrCtx)) return requestOrCtx;
  // Pages Router APIContext — has a .request property
  const ctx = requestOrCtx as { request?: Request };
  if (isRequest(ctx.request)) return ctx.request;
  throw new Error("Invalid handler argument: expected Request or APIContext");
}

/**
 * Create a POST handler for a chat API route.
 *
 * Works with both App Router and Pages Router:
 * - App Router: `app/api/chat/route.ts` — handler receives `(request, context)`
 * - Pages Router: `pages/api/chat.ts` — handler receives `(ctx)`
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
  // deno-lint-ignore no-explicit-any
  return async function POST(requestOrCtx: any): Promise<Response> {
    const request = extractRequest(requestOrCtx);
    // Resolve agent outside try so it's available in the catch block for
    // extracting the system prompt in the 503 fallback response.
    let agent: ReturnType<typeof getAgent> | undefined;
    try {
      agent = getAgent(agentId);
    } catch {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    try {
      const body = await request.json();
      const { messages: rawMessages } = chatRequestSchema.parse(body);

      if (!agent) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
      }

      const context = typeof options?.context === "function"
        ? await options.context(request)
        : options?.context ?? { userId: "current-user" };

      const baseMessages = transformUIMessages(rawMessages);
      const beforeStreamResult = await options?.beforeStream?.({
        request,
        messages: baseMessages,
        context,
        lastUserText: extractLastUserText(rawMessages),
      });

      if (isResponseLike(beforeStreamResult)) return beforeStreamResult;

      let hookResult: ChatHandlerBeforeStreamResult | undefined;
      if (beforeStreamResult) hookResult = beforeStreamResult;

      const messages = applyBeforeStreamResult(baseMessages, hookResult);
      const streamContext = hookResult?.context ?? context;

      // Clear server-side memory before each request —
      // the client (useChat) manages full conversation history
      await agent.clearMemory();

      const result = await agent.stream({
        messages,
        context: streamContext,
      });

      return result.toDataStreamResponse();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: "Invalid request", details: error.errors },
          { status: 400 },
        );
      }

      // Detect structured "no_ai_available" errors from local engine
      const vfError = fromError(error);
      if (vfError?.type === "no_ai_available") {
        // Resolve the agent's system prompt so the browser can use it for inference
        const systemConfig = agent?.config?.system;
        let systemPrompt = "You are a helpful AI assistant.";
        if (typeof systemConfig === "string") {
          systemPrompt = systemConfig;
        } else if (typeof systemConfig === "function") {
          try {
            systemPrompt = await systemConfig();
          } catch {
            // Fall back to default
          }
        }

        return Response.json(
          {
            code: "NO_AI_AVAILABLE",
            fallback: "browser",
            model: DEFAULT_LOCAL_MODEL,
            systemPrompt,
          },
          { status: 503 },
        );
      }

      return Response.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}
