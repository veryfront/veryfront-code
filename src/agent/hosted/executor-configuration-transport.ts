import type { ExecutorBinding } from "../executor/protocol.ts";
import type { ExecutorChannel, ExecutorOperation } from "../executor/channel.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
const now = Date.now, parse = JSON.parse;
const CHUNK_CHARS = 32 * 1024, MAX_CHARS = 4 * 1024 * 1024;
const requestSchema = defineSchema((v) =>
  v.object({ configurationId: v.string().min(1).max(256) }).strict()
);
const chunkSchema = defineSchema((v) =>
  v.object({
    index: v.number().int().nonnegative().max(MAX_CHARS / CHUNK_CHARS - 1),
    text: v.string().min(1).max(CHUNK_CHARS),
  }).strict()
);
/** Reverse read is owned by exactly one admitted allocation, never a global configuration lookup. */
export function createExecutorConfigurationOperation(
  binding: ExecutorBinding,
  configurationId: string,
  configuration: unknown,
): ExecutorOperation {
  const expected = { ...binding };
  const text = privateJsonStringify(configuration);
  if (typeof text !== "string" || text.length > MAX_CHARS) {
    throw new TypeError("Application configuration is too large");
  }
  return {
    mode: "stream",
    async *handle(value, context) {
      const request = requestSchema().safeParse(value);
      if (
        !request.success || request.data.configurationId !== configurationId ||
        context.binding.allocationId !== expected.allocationId ||
        context.binding.invocationId !== expected.invocationId ||
        context.binding.generation !== expected.generation
      ) throw new TypeError("Application configuration is unavailable");
      let index = 0;
      for (let offset = 0; offset < text.length; offset += CHUNK_CHARS) {
        context.signal.throwIfAborted();
        if (context.deadline <= now()) throw new Error("Application configuration request expired");
        yield { index: index++, text: text.slice(offset, offset + CHUNK_CHARS) };
      }
    },
  };
}
/** Read bounded ordered data; the profile-specific caller must validate scope/content before evaluation. */
export async function readExecutorConfiguration(
  channel: Pick<ExecutorChannel, "stream">,
  operation: "http.configuration" | "project.configuration",
  configurationId: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  signal.throwIfAborted();
  let text = "", index = 0;
  for await (const value of channel.stream(operation, { configurationId }, { signal, timeoutMs })) {
    const chunk = chunkSchema().safeParse(value);
    if (!chunk.success || chunk.data.index !== index++) {
      throw new TypeError("Invalid application configuration stream");
    }
    if (text.length + chunk.data.text.length > MAX_CHARS) {
      throw new TypeError("Application configuration is too large");
    }
    text += chunk.data.text;
  }
  signal.throwIfAborted();
  try {
    return parse(text);
  } catch {
    throw new TypeError("Invalid application configuration stream");
  }
}
