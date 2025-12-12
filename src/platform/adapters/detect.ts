import { logger } from "@veryfront/utils";
import type { RuntimeAdapter, RuntimeId } from "./base.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

// Re-export the registry for convenient access
export { runtime } from "./registry.ts";

interface DenoGlobal {
  Deno: {
    version: { deno: string };
    [key: string]: unknown;
  };
}

interface BunGlobal {
  Bun: {
    version: string;
    [key: string]: unknown;
  };
}

interface CloudflareGlobal {
  caches: unknown;
  WebSocketPair: unknown;
}

function isDeno(global: typeof globalThis): global is typeof globalThis & DenoGlobal {
  return "Deno" in global &&
    typeof (global as DenoGlobal).Deno === "object" &&
    typeof (global as DenoGlobal).Deno.version === "object";
}

function isBun(global: typeof globalThis): global is typeof globalThis & BunGlobal {
  return "Bun" in global && typeof (global as BunGlobal).Bun === "object";
}

function isCloudflare(global: typeof globalThis): global is typeof globalThis & CloudflareGlobal {
  return "caches" in global && "WebSocketPair" in global;
}

/**
 * Detect the current runtime environment
 * @returns Runtime identifier
 */
export function detectRuntime(): RuntimeId | "unknown" {
  if (isDeno(globalThis)) {
    return "deno";
  }

  if (isBun(globalThis)) {
    return "bun";
  }

  const globalProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (globalProcess?.versions?.node) {
    return "node";
  }

  if (isCloudflare(globalThis)) {
    return "cloudflare";
  }

  return "unknown";
}

/**
 * Get the runtime adapter for the current environment
 *
 * @deprecated Use `runtime.get()` from `./registry.ts` instead for singleton management
 *
 * @example
 * ```ts
 * // Old way (deprecated)
 * const adapter = await getAdapter();
 *
 * // New way (recommended)
 * import { runtime } from "@veryfront/platform/adapters/registry.ts";
 * const adapter = await runtime.get();
 * ```
 */
export async function getAdapter(): Promise<RuntimeAdapter> {
  const runtimeId = detectRuntime();

  switch (runtimeId) {
    case "deno": {
      const { denoAdapter } = await import("./deno.ts");
      return denoAdapter;
    }

    case "bun": {
      const { bunAdapter } = await import("./bun.ts");
      return bunAdapter;
    }

    case "node": {
      const { nodeAdapter } = await import("./node.ts");
      return nodeAdapter;
    }

    case "cloudflare": {
      const errorMsg = "Cloudflare adapter requires manual initialization with environment. " +
        "Please use createCloudflareAdapter() with your environment context.";
      logger.error("[Adapter Detection]", errorMsg);
      throw toError(createError({
        type: "config",
        message: errorMsg,
      }));
    }

    default: {
      const supportedRuntimes = ["deno", "bun", "node", "cloudflare"];
      const errorMsg = `Unsupported runtime: ${runtimeId}. Supported runtimes: ${
        supportedRuntimes.join(", ")
      }`;
      logger.error("[Adapter Detection]", errorMsg);
      throw toError(createError({
        type: "config",
        message: errorMsg,
      }));
    }
  }
}

export { denoAdapter } from "./deno.ts";
export { nodeAdapter } from "./node.ts";
export { bunAdapter } from "./bun.ts";

export type {
  EnvironmentAdapter,
  FileSystemAdapter,
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeFeatures,
  RuntimeId,
} from "./base.ts";
