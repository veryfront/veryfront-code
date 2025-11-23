import process from "node:process";
import { logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "./base.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

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
  return "Deno" in global && typeof (global as DenoGlobal).Deno === "object";
}

function isBun(global: typeof globalThis): global is typeof globalThis & BunGlobal {
  return "Bun" in global && typeof (global as BunGlobal).Bun === "object";
}

function isCloudflare(global: typeof globalThis): global is typeof globalThis & CloudflareGlobal {
  return "caches" in global && "WebSocketPair" in global;
}

export function detectRuntime() {
  if (isDeno(globalThis)) {
    return "deno";
  }

  if (isBun(globalThis)) {
    return "bun";
  }

  if (process?.versions?.node) {
    return "node";
  }

  if (isCloudflare(globalThis)) {
    return "cloudflare";
  }

  return "unknown";
}

export async function getAdapter(): Promise<RuntimeAdapter> {
  const runtime = detectRuntime();

  switch (runtime) {
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
      const errorMsg = `Unsupported runtime: ${runtime}. Supported runtimes: ${
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
  RuntimeFeatures,
} from "./base.ts";
