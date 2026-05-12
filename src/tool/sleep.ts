import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { resolveSchemaValidator } from "#veryfront/schemas/define.ts";
import { tool } from "./factory.ts";
import type { Tool } from "./types.ts";

export const DEFAULT_SLEEP_TOOL_MAX_SECONDS = 60;

export type SleepToolWait = (milliseconds: number) => Promise<void> | void;

export type CreateSleepToolOptions = {
  maxSeconds?: number;
  wait?: SleepToolWait;
};

const defaultSleepToolWait: SleepToolWait = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

interface SleepToolInputShape {
  seconds: number;
}

/**
 * Build the sleep-tool input schema parameterised by `maxSeconds`.
 *
 * Resolves the `SchemaValidator` through the shared fallback path (rather than going
 * through `defineSchema`) because `defineSchema` produces a memoized
 * zero-arg getter — incompatible with per-instance parametric schemas.
 */
function createSleepToolInputSchema(maxSeconds: number): Schema<SleepToolInputShape> {
  const v = resolveSchemaValidator();
  return v.object({
    seconds: v.number().min(1).max(maxSeconds).describe(
      `Number of seconds to wait (1-${maxSeconds})`,
    ),
  }) as unknown as Schema<SleepToolInputShape>;
}

export type SleepToolInput = InferSchema<ReturnType<typeof createSleepToolInputSchema>>;

export type SleepToolOutput = {
  sleptFor: number;
  message: string;
};

export function createSleepTool(options: CreateSleepToolOptions = {}) {
  const maxSeconds = options.maxSeconds ?? DEFAULT_SLEEP_TOOL_MAX_SECONDS;
  const wait = options.wait ?? defaultSleepToolWait;

  return tool<SleepToolInput, SleepToolOutput>({
    id: "sleep",
    description:
      `Wait for a specified number of seconds before continuing. Use this when a task needs to pause execution, such as waiting for an external process to complete or adding a delay between operations. Maximum sleep time is ${maxSeconds} seconds.`,
    inputSchema: createSleepToolInputSchema(maxSeconds),
    execute: async ({ seconds }) => {
      const clampedSeconds = Math.min(Math.max(1, seconds), maxSeconds);
      await wait(clampedSeconds * 1000);
      return {
        sleptFor: clampedSeconds,
        message: `Waited for ${clampedSeconds} second${clampedSeconds === 1 ? "" : "s"}`,
      };
    },
  });
}

/**
 * Lazily-built default sleep tool.
 *
 * Construction is deferred to first access so importers don't pay the
 * SchemaValidator-resolution cost (and don't fail under tests that haven't
 * registered the adapter) just by loading this module.
 */
let cachedDefaultSleepTool: Tool<SleepToolInput, SleepToolOutput> | undefined;
function getDefaultSleepTool(): Tool<SleepToolInput, SleepToolOutput> {
  cachedDefaultSleepTool ??= createSleepTool();
  return cachedDefaultSleepTool;
}

/**
 * Default sleep tool (max 60 s) exposed as a property accessor so the
 * underlying `tool({...})` materialization is deferred until first use.
 * Preserves the existing `sleepTool.execute(...)` call shape.
 */
export const sleepTool: Tool<SleepToolInput, SleepToolOutput> = new Proxy(
  {} as Tool<SleepToolInput, SleepToolOutput>,
  {
    get(_target, prop, receiver) {
      return Reflect.get(getDefaultSleepTool(), prop, receiver);
    },
    has(_target, prop) {
      return prop in getDefaultSleepTool();
    },
    ownKeys() {
      return Reflect.ownKeys(getDefaultSleepTool());
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Object.getOwnPropertyDescriptor(getDefaultSleepTool(), prop);
    },
  },
);
