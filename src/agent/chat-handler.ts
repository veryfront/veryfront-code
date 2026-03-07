import { z } from "zod";
import { getAgent } from "./composition/index.ts";
import type { Message } from "./types.ts";
import { fromError } from "#veryfront/errors/veryfront-error.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { DEFAULT_LOCAL_MODEL } from "../provider/local/model-catalog.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";

/** Maximum character length for a single text part */
const MAX_TEXT_PART_LENGTH = 10_000;
/** Maximum number of messages in a single chat request */
const MAX_MESSAGES_PER_REQUEST = 100;

// ---------------------------------------------------------------------------
// Zod schemas for validating AI SDK v5 chat UI messages
// ---------------------------------------------------------------------------

const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(MAX_TEXT_PART_LENGTH),
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

const stepPartSchema = z.object({
  type: z.enum(["step-start", "step-end"]),
  stepIndex: z.number().optional(),
}).passthrough();

const reasoningPartSchema = z.object({
  type: z.literal("reasoning"),
  text: z.string(),
  state: z.string().optional(),
}).passthrough();

const partSchema = z.union([
  textPartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
  dynamicToolPartSchema,
  stepPartSchema,
  reasoningPartSchema,
]);

const messageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  parts: z.array(partSchema).min(1),
});

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES_PER_REQUEST),
  model: z.string().optional(),
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

  if (!("type" in part) || typeof part.type !== "string") return false;
  if (!part.type.startsWith("tool-") || part.type === "tool-result") return false;

  return "output" in part && part.output !== undefined;
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
  return typeof part === "object" && part !== null && "type" in part && part.type === "text";
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
    "status" in value &&
    typeof value.status === "number" &&
    "headers" in value &&
    typeof value.headers === "object" &&
    "bodyUsed" in value &&
    typeof value.bodyUsed === "boolean"
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
    "json" in obj &&
    typeof obj.json === "function" &&
    "url" in obj &&
    typeof obj.url === "string" &&
    "method" in obj &&
    typeof obj.method === "string"
  );
}

function extractRequest(requestOrCtx: unknown): Request {
  if (isRequest(requestOrCtx)) return requestOrCtx;
  // Pages Router APIContext — has a .request property
  if (
    typeof requestOrCtx === "object" &&
    requestOrCtx !== null &&
    "request" in requestOrCtx
  ) {
    const candidate = (requestOrCtx as Record<string, unknown>).request;
    if (isRequest(candidate)) return candidate;
  }
  throw INVALID_ARGUMENT.create({
    detail: "Invalid handler argument: expected Request or APIContext",
  });
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
  return async function POST(requestOrCtx: unknown): Promise<Response> {
    const request = extractRequest(requestOrCtx);
    let agent: ReturnType<typeof getAgent> | undefined;
    try {
      agent = getAgent(agentId);
    } catch (error) {
      agentLogger.debug("getAgent lookup failed", { error });
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }
    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    try {
      const body = await request.json();
      const { messages: rawMessages, model: requestModel } = chatRequestSchema.parse(body);

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

      const hookResult = beforeStreamResult ?? undefined;
      const messages = applyBeforeStreamResult(baseMessages, hookResult);
      const streamContext = hookResult?.context ?? context;

      // Clear server-side memory before each request —
      // the client (useChat) manages full conversation history
      await agent.clearMemory();

      const result = await agent.stream({
        messages,
        context: streamContext,
        ...(requestModel ? { model: requestModel } : {}),
      });

      return result.toDataStreamResponse();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          {
            error: "Invalid request",
            details: error.errors.map((e) => ({ path: e.path, message: e.message })),
          },
          { status: 400 },
        );
      }

      // Detect structured "no_ai_available" errors from local engine.
      // Never send the server-side system prompt to the client — it may
      // contain business logic, personas, or internal instructions.
      // The client (useChat) has its own systemPrompt option for browser fallback.
      const vfError = fromError(error);
      if (vfError?.type === "no_ai_available") {
        return Response.json(
          {
            code: "NO_AI_AVAILABLE",
            fallback: "browser",
            model: DEFAULT_LOCAL_MODEL,
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
