/**
 * Host Runtime: the one seam between framework code and the process it runs
 * in. It covers environment variables, the working directory, command-line
 * arguments, process exit, and termination signals.
 *
 * Code that takes a `HostRuntime` never touches `Deno.env`, `process.env`,
 * `Deno.args`, `Deno.exit`, or signal listeners directly, so it runs against
 * the live process in production and against an isolated in-memory host in
 * tests without any global state being read, mutated, or restored.
 *
 * Two adapters exist and no others should: {@link liveHostRuntime} delegates
 * to the cross-runtime compat functions in this directory, and
 * {@link createInMemoryHostRuntime} holds everything in plain data.
 *
 * @module platform/compat/process/host-runtime
 */

import { deleteEnv, env, getEnv, setEnv } from "./env.ts";
import { cwd, exit, getArgs, onSignal } from "./lifecycle.ts";

/** Signals a host can deliver to a subscriber. */
export type HostSignal = "SIGINT" | "SIGTERM";

/**
 * Environment access through a host. Structurally a superset of
 * `EnvironmentAdapter` in `platform/adapters/base.ts`, so a host env satisfies
 * that contract too.
 */
export interface HostRuntimeEnv {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  has(key: string): boolean;
  toObject(): Record<string, string>;
}

/** The process a unit of framework code runs in, as seen by that code. */
export interface HostRuntime {
  readonly env: HostRuntimeEnv;
  /** Current working directory. */
  cwd(): string;
  /** Command-line arguments after the executable and entrypoint. */
  args(): readonly string[];
  /** End the process. The live host never returns; the in-memory host throws. */
  exit(code?: number): never;
  /**
   * Subscribe to a termination signal.
   *
   * @returns An idempotent disposer for exactly this subscription.
   */
  onSignal(signal: HostSignal, handler: () => void): () => void;
}

let liveHost: HostRuntime | undefined;

/**
 * The production adapter: every member delegates to the compat functions, so
 * behaviour is identical to calling them directly.
 */
export function liveHostRuntime(): HostRuntime {
  liveHost ??= {
    env: {
      get: (key) => getEnv(key),
      set: (key, value) => setEnv(key, value),
      delete: (key) => deleteEnv(key),
      has: (key) => getEnv(key) !== undefined,
      toObject: () => env(),
    },
    cwd: () => cwd(),
    args: () => getArgs(),
    exit: (code) => exit(code),
    onSignal: (signal, handler) => onSignal(signal, handler),
  };
  return liveHost;
}

const hostExits = new WeakSet<object>();

/**
 * Thrown by an in-memory host's `exit` so the calling code stops where the
 * real process would have ended. Identify it with {@link isHostExit}.
 */
export class HostExit extends Error {
  override readonly name = "HostExit";
  readonly code: number;

  constructor(code: number) {
    super(`Host exited with code ${code}`);
    this.code = code;
    hostExits.add(this);
  }
}

/** Return whether a value is an exit raised by an in-memory host. */
export function isHostExit(value: unknown): value is HostExit {
  return typeof value === "object" && value !== null && hostExits.has(value);
}

/** Initial state for {@link createInMemoryHostRuntime}. Everything is optional. */
export interface InMemoryHostRuntimeInit {
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  args?: readonly string[];
}

/** The in-memory adapter, with the hooks a test needs to observe and drive it. */
export interface InMemoryHostRuntime extends HostRuntime {
  /** Exit codes passed to `exit`, oldest first. */
  readonly exits: readonly number[];
  /**
   * Deliver a signal to every current subscriber, in subscription order.
   *
   * @returns How many handlers ran.
   */
  emitSignal(signal: HostSignal): number;
}

/** Default working directory for an in-memory host. */
export const IN_MEMORY_HOST_CWD = "/in-memory";

/**
 * The test adapter: an isolated env map, a fixed cwd and argv, recorded exits,
 * and signal subscribers a test fires with `emitSignal`. Two instances never
 * share state, and nothing here reads or writes the real process.
 */
export function createInMemoryHostRuntime(
  init: InMemoryHostRuntimeInit = {},
): InMemoryHostRuntime {
  const envVars = new Map(Object.entries(init.env ?? {}));
  const workingDirectory = init.cwd ?? IN_MEMORY_HOST_CWD;
  const args = Object.freeze([...(init.args ?? [])]);
  const exits: number[] = [];
  const subscribers = new Map<HostSignal, Array<{ readonly handler: () => void }>>();

  return {
    env: {
      get: (key) => envVars.get(key),
      set: (key, value) => {
        envVars.set(key, value);
      },
      delete: (key) => {
        envVars.delete(key);
      },
      has: (key) => envVars.has(key),
      toObject: () => Object.fromEntries(envVars),
    },
    cwd: () => workingDirectory,
    args: () => args,
    exit: (code = 0) => {
      exits.push(code);
      throw new HostExit(code);
    },
    onSignal: (signal, handler) => {
      let entries = subscribers.get(signal);
      if (!entries) {
        entries = [];
        subscribers.set(signal, entries);
      }
      // One entry per subscription, so subscribing the same handler twice
      // yields two deliveries and two independent disposers.
      const entry = { handler };
      entries.push(entry);
      return () => {
        const index = entries.indexOf(entry);
        if (index !== -1) entries.splice(index, 1);
      };
    },
    exits,
    emitSignal: (signal) => {
      const entries = [...(subscribers.get(signal) ?? [])];
      for (const entry of entries) entry.handler();
      return entries.length;
    },
  };
}
