/**
 * Simple VCR (Video Cassette Recorder) for API testing
 * Uses cross-runtime platform abstractions.
 *
 * Record:  deno task test:vcr:record
 * Replay:  deno task test:vcr (default)
 *
 * @module cli/test-utils/vcr
 */

import { load } from "@std/dotenv";
import { cliLogger } from "@veryfront/utils";
import { cwd, getEnv } from "@veryfront/platform/compat/process.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import type { ApiClient } from "../shared/config.ts";

// Load .env.local for credentials in record mode (skip validation against .env.example)
try {
  await load({ envPath: ".env.local", examplePath: null, export: true });
} catch {
  // .env.local doesn't exist - that's fine for playback mode
}

interface VCREntry {
  method: string;
  url: string;
  body?: unknown;
  response: unknown;
}

interface VCRCassette {
  meta: {
    projectSlug: string;
    recordedAt: string;
  };
  entries: VCREntry[];
}

/**
 * Create a VCR-wrapped API client
 *
 * - Record mode (VCR=record): calls real API, saves responses
 * - Playback mode (default): returns saved responses (matched by method+url)
 */
export async function createVCRClient(
  cassetteName: string,
  realClient?: ApiClient,
  projectSlug?: string,
): Promise<{ client: ApiClient; save: () => Promise<void>; projectSlug: string }> {
  const fs = createFileSystem();
  const recording = getEnv("VCR") === "record";
  const fixturesDir = new URL("../commands/fixtures", import.meta.url).pathname;
  const cassettePath = `${fixturesDir}/${cassetteName}.json`;

  let cassette: VCRCassette = {
    meta: { projectSlug: projectSlug || "", recordedAt: "" },
    entries: [],
  };
  const usedIndices = new Set<number>();

  // Load existing cassette for playback
  if (!recording) {
    try {
      const content = await fs.readTextFile(cassettePath);
      const parsed: unknown = JSON.parse(content);
      // Handle both old (array) and new (object with meta) format
      if (Array.isArray(parsed)) {
        // Extract project slug from first URL
        const firstEntry = parsed[0];
        const firstUrl = (firstEntry && typeof firstEntry === "object" && "url" in firstEntry)
          ? String(firstEntry.url)
          : "";
        const match = firstUrl.match(/\/projects\/([^/]+)/);
        cassette = {
          meta: { projectSlug: match?.[1] || "test-project", recordedAt: "" },
          entries: parsed,
        };
      } else if (parsed && typeof parsed === "object" && "entries" in parsed) {
        cassette = parsed as VCRCassette;
      }
    } catch {
      throw new Error(
        `Cassette not found: ${cassettePath}\nRun with VCR=record to create it.`,
      );
    }
  } else {
    if (!projectSlug) {
      throw new Error("projectSlug required for VCR=record mode");
    }
    cassette.meta = {
      projectSlug,
      recordedAt: new Date().toISOString(),
    };
  }

  // Find matching entry by method and url
  function findEntry(method: string, url: string): VCREntry | undefined {
    for (let i = 0; i < cassette.entries.length; i++) {
      const entry = cassette.entries[i];
      if (entry && !usedIndices.has(i) && entry.method === method && entry.url === url) {
        usedIndices.add(i);
        return entry;
      }
    }
    return undefined;
  }

  // Record or replay a request
  async function recordOrReplay<T>(
    method: string,
    url: string,
    body: unknown,
    realCall: () => Promise<T>,
  ): Promise<T> {
    if (recording) {
      if (!realClient) {
        throw new Error("Real client required for VCR=record mode");
      }
      const response = await realCall();
      cassette.entries.push({ method, url, body, response });
      return response;
    } else {
      const entry = findEntry(method, url);
      if (!entry) {
        throw new Error(`No recorded response for: ${method.toUpperCase()} ${url}`);
      }
      // VCR responses are stored as unknown - caller expects T
      // This is safe because the same call that recorded T will replay it
      return entry.response as T;
    }
  }

  // Build client with explicit method implementations
  const client: ApiClient = {
    get<T>(url: string, params?: Record<string, string>): Promise<T> {
      return recordOrReplay("get", url, params, () => realClient!.get<T>(url, params));
    },
    post<T>(url: string, body?: unknown): Promise<T> {
      return recordOrReplay("post", url, body, () => realClient!.post<T>(url, body));
    },
    put<T>(url: string, body?: unknown): Promise<T> {
      return recordOrReplay("put", url, body, () => realClient!.put<T>(url, body));
    },
    patch<T>(url: string, body?: unknown): Promise<T> {
      return recordOrReplay("patch", url, body, () => realClient!.patch<T>(url, body));
    },
    delete<T>(url: string): Promise<T> {
      return recordOrReplay("delete", url, undefined, () => realClient!.delete<T>(url));
    },
  };

  async function save(): Promise<void> {
    if (recording && cassette.entries.length > 0) {
      await fs.mkdir(fixturesDir, { recursive: true });
      await fs.writeTextFile(
        cassettePath,
        JSON.stringify(cassette, null, 2) + "\n",
      );
      cliLogger.info(`Saved cassette: ${cassettePath} (${cassette.entries.length} entries)`);
    }
  }

  return { client, save, projectSlug: cassette.meta.projectSlug };
}

/**
 * Check if running in record mode
 */
export function isRecording(): boolean {
  return getEnv("VCR") === "record";
}

/**
 * Test context for VCR-based integration tests
 */
export interface VCRTestContext {
  client: ApiClient;
  projectSlug: string;
  save: () => Promise<void>;
}

/**
 * Initialize VCR test context for integration tests
 *
 * Call this in beforeAll to set up the VCR client. Returns context that
 * should be used throughout the test suite.
 *
 * Usage:
 * ```ts
 * import { initVCRTest, isRecording, type VCRTestContext } from "../test-utils/vcr.ts";
 *
 * describe("my command integration", () => {
 *   let ctx: VCRTestContext;
 *
 *   beforeAll(async () => {
 *     ctx = await initVCRTest("my-cassette");
 *   });
 *
 *   afterAll(async () => {
 *     await ctx.save();
 *   });
 *
 *   it("should do something", async () => {
 *     const result = await myFunction(ctx.client, ctx.projectSlug);
 *   });
 * });
 * ```
 */
export async function initVCRTest(cassetteName: string): Promise<VCRTestContext> {
  if (isRecording()) {
    const slug = getEnv("VERYFRONT_PROJECT_SLUG");
    if (!slug) {
      throw new Error("VCR=record requires VERYFRONT_PROJECT_SLUG");
    }
    // Dynamic import to avoid loading config module in playback mode
    const { createApiClient, resolveConfig } = await import("../shared/config.ts");
    const config = await resolveConfig(cwd());
    const realClient = createApiClient(config);
    const vcr = await createVCRClient(cassetteName, realClient, slug);
    return {
      client: vcr.client,
      projectSlug: vcr.projectSlug,
      save: vcr.save,
    };
  } else {
    const vcr = await createVCRClient(cassetteName);
    return {
      client: vcr.client,
      projectSlug: vcr.projectSlug,
      save: vcr.save,
    };
  }
}
