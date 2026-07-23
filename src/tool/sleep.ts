import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { resolveSchemaValidator } from "#veryfront/schemas/define.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { tool } from "./factory.ts";
import type { Tool } from "./types.ts";

/** Default value for sleep tool max seconds. */
export const DEFAULT_SLEEP_TOOL_MAX_SECONDS = 60;

/** Public API contract for sleep tool wait. */
export type SleepToolWait = (
  milliseconds: number,
  abortSignal?: AbortSignal,
) => Promise<void> | void;

/** Options accepted by create sleep tool. */
export type CreateSleepToolOptions = {
  /** Maximum accepted whole-second delay. */
  maxSeconds?: number;
  /** Optional wait implementation used by hosts and tests. */
  wait?: SleepToolWait;
};

const MAX_TIMER_MILLISECONDS = 2_147_483_647;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined
    ? new DOMException("Sleep was cancelled", "AbortError")
    : signal.reason;
}

const defaultSleepToolWait: SleepToolWait = (milliseconds, abortSignal) =>
  new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(abortReason(abortSignal));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(abortSignal as AbortSignal));
    };
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });

/** Input payload for sleep tool. */
export interface SleepToolInput {
  /** Whole number of seconds to wait. */
  seconds: number;
}

/**
 * Build the sleep-tool input schema parameterised by `maxSeconds`.
 *
 * Resolves the `SchemaValidator` through the shared fallback path (rather than going
 * through `defineSchema`) because `defineSchema` produces a memoized
 * zero-arg getter — incompatible with per-instance parametric schemas.
 */
function createSleepToolInputSchema(maxSeconds: number): Schema<SleepToolInput> {
  const v = resolveSchemaValidator();
  return v.object({
    seconds: v.number().int().min(1).max(maxSeconds).describe(
      `Number of seconds to wait (1-${maxSeconds})`,
    ),
  }) as unknown as Schema<SleepToolInput>;
}

/** Output from sleep tool. */
export type SleepToolOutput = {
  /** Number of seconds requested by the caller. */
  sleptFor: number;
  /** Human-readable completion message. */
  message: string;
};

/** Create sleep tool. */
export function createSleepTool(
  options: CreateSleepToolOptions = {},
): Tool<SleepToolInput, SleepToolOutput> {
  const maxSeconds = options.maxSeconds ?? DEFAULT_SLEEP_TOOL_MAX_SECONDS;
  if (
    !Number.isSafeInteger(maxSeconds) || maxSeconds < 1 ||
    maxSeconds > Math.floor(MAX_TIMER_MILLISECONDS / 1000)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "maxSeconds must be a positive safe integer" });
  }
  if (options.wait !== undefined && typeof options.wait !== "function") {
    throw INVALID_ARGUMENT.create({ detail: "wait must be a function" });
  }
  const wait = options.wait ?? defaultSleepToolWait;

  return tool<SleepToolInput, SleepToolOutput>({
    id: "sleep",
    description:
      `Wait for a specified number of seconds before continuing. Use this when a task needs to pause execution, such as waiting for an external process to complete or adding a delay between operations. Maximum sleep time is ${maxSeconds} seconds.`,
    inputSchema: createSleepToolInputSchema(maxSeconds),
    execute: async ({ seconds }, context) => {
      await wait(seconds * 1000, context?.abortSignal);
      return {
        sleptFor: seconds,
        message: `Waited for ${seconds} second${seconds === 1 ? "" : "s"}`,
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
const defaultSleepToolTarget = {} as Tool<SleepToolInput, SleepToolOutput>;
let defaultSleepToolMaterialized = false;

function getDefaultSleepTool(): Tool<SleepToolInput, SleepToolOutput> {
  if (!defaultSleepToolMaterialized) {
    const created = createSleepTool();
    Object.defineProperties(
      defaultSleepToolTarget,
      Object.getOwnPropertyDescriptors(created),
    );
    defaultSleepToolMaterialized = true;
  }
  return defaultSleepToolTarget;
}

/**
 * Default sleep tool (max 60 s) exposed as a property accessor so the
 * underlying `tool({...})` materialization is deferred until first use.
 * Preserves the existing `sleepTool.execute(...)` call shape.
 */
export const sleepTool: Tool<SleepToolInput, SleepToolOutput> = new Proxy(
  defaultSleepToolTarget,
  {
    get(target, prop, receiver) {
      getDefaultSleepTool();
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      getDefaultSleepTool();
      return Reflect.set(target, prop, value, receiver);
    },
    has(target, prop) {
      getDefaultSleepTool();
      return Reflect.has(target, prop);
    },
    ownKeys() {
      getDefaultSleepTool();
      return Reflect.ownKeys(defaultSleepToolTarget);
    },
    getOwnPropertyDescriptor(target, prop) {
      getDefaultSleepTool();
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(target, prop, descriptor) {
      getDefaultSleepTool();
      return Reflect.defineProperty(target, prop, descriptor);
    },
    deleteProperty(target, prop) {
      getDefaultSleepTool();
      return Reflect.deleteProperty(target, prop);
    },
    getPrototypeOf(target) {
      getDefaultSleepTool();
      return Reflect.getPrototypeOf(target);
    },
    setPrototypeOf(target, prototype) {
      getDefaultSleepTool();
      return Reflect.setPrototypeOf(target, prototype);
    },
    isExtensible(target) {
      getDefaultSleepTool();
      return Reflect.isExtensible(target);
    },
    preventExtensions(target) {
      getDefaultSleepTool();
      return Reflect.preventExtensions(target);
    },
  },
);
