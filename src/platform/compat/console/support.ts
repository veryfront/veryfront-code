import { detectRuntimeFromHost } from "../runtime.ts";
import type { DetectedRuntime } from "../runtime.ts";
import type { ColorFunction, ConsoleStyler } from "./types.ts";

type PropertyHost = object | ((...args: never[]) => unknown);

function isPropertyHost(value: unknown): value is PropertyHost {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function readProperty(value: unknown, key: PropertyKey): unknown {
  if (!isPropertyHost(value)) return undefined;

  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function callWithoutArguments(receiver: unknown, key: PropertyKey): unknown {
  const method = readProperty(receiver, key);
  if (typeof method !== "function") return undefined;

  try {
    return Reflect.apply(method, receiver, []);
  } catch {
    return undefined;
  }
}

type ConsoleRuntime = Extract<DetectedRuntime, "deno" | "node" | "bun">;

interface EnvironmentRead {
  accessible: boolean;
  value?: string;
}

function environmentRead(value: unknown): EnvironmentRead {
  if (value === undefined) return { accessible: true };
  if (typeof value === "string") return { accessible: true, value };
  return { accessible: false };
}

function readDenoEnvironment(host: unknown, key: string): EnvironmentRead {
  const deno = readProperty(host, "Deno");
  const env = readProperty(deno, "env");
  const get = readProperty(env, "get");
  if (typeof get !== "function") return { accessible: false };

  try {
    return environmentRead(Reflect.apply(get, env, [key]));
  } catch {
    return { accessible: false };
  }
}

function readNodeEnvironment(host: unknown, key: string): EnvironmentRead {
  try {
    const process = Reflect.get(host as PropertyHost, "process");
    if (!isPropertyHost(process)) return { accessible: false };
    const env = Reflect.get(process, "env");
    if (!isPropertyHost(env)) return { accessible: false };
    return environmentRead(Reflect.get(env, key));
  } catch {
    return { accessible: false };
  }
}

function readEnvironment(
  host: unknown,
  runtime: ConsoleRuntime,
  key: string,
): EnvironmentRead {
  if (runtime === "deno") return readDenoEnvironment(host, key);
  return readNodeEnvironment(host, key);
}

function isDenoNoColor(host: unknown, runtime: ConsoleRuntime): boolean {
  if (runtime !== "deno") return false;
  return readProperty(readProperty(host, "Deno"), "noColor") === true;
}

function isTerminal(host: unknown, runtime: ConsoleRuntime): boolean {
  if (runtime === "deno") {
    const stdout = readProperty(readProperty(host, "Deno"), "stdout");
    return callWithoutArguments(stdout, "isTerminal") === true;
  }
  if (runtime === "node" || runtime === "bun") {
    const stdout = readProperty(readProperty(host, "process"), "stdout");
    return readProperty(stdout, "isTTY") === true;
  }
  return false;
}

/** Determine color support without throwing in restricted or browser runtimes. */
export function supportsColor(host: unknown = globalThis): boolean {
  const detectedRuntime = detectRuntimeFromHost(host);
  if (
    detectedRuntime !== "deno" && detectedRuntime !== "node" && detectedRuntime !== "bun"
  ) {
    return false;
  }

  const forceColor = readEnvironment(host, detectedRuntime, "FORCE_COLOR");
  if (!forceColor.accessible || forceColor.value === "0") return false;

  const noColor = readEnvironment(host, detectedRuntime, "NO_COLOR");
  if (!noColor.accessible || isDenoNoColor(host, detectedRuntime) || noColor.value !== undefined) {
    return false;
  }

  if (forceColor.value !== undefined) return true;

  const term = readEnvironment(host, detectedRuntime, "TERM");
  if (!term.accessible || term.value?.trim().toLowerCase() === "dumb") return false;
  return isTerminal(host, detectedRuntime);
}

const noOp: ColorFunction = (text: string) => text;

const plainColors: ConsoleStyler = {
  red: noOp,
  green: noOp,
  yellow: noOp,
  blue: noOp,
  cyan: noOp,
  magenta: noOp,
  white: noOp,
  gray: noOp,
  bold: noOp,
  dim: noOp,
  italic: noOp,
  underline: noOp,
  strikethrough: noOp,
  reset: noOp,
};

/** Select one immutable implementation for the lifetime of an imported module. */
export function selectConsoleStyler(
  styledColors: ConsoleStyler,
  host: unknown = globalThis,
): ConsoleStyler {
  return supportsColor(host) ? styledColors : plainColors;
}
