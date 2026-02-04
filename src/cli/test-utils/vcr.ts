/*************************
 * Simple VCR (Video Cassette Recorder) for API testing
 * Uses cross-runtime platform abstractions.
 *
 * Record:  deno task test:vcr:record
 * Replay:  deno task test:vcr (default)
 *
 * @module cli/test-utils/vcr
 *************************/

import { load } from "#std/dotenv.ts";
import { cliLogger } from "#veryfront/utils";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";
import type { ApiClient } from "../shared/config.ts";

// Load .env.local for credentials in record mode
try {
  await load({ envPath: ".env.local", export: true });
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

function parseCassette(parsed: unknown): VCRCassette | undefined {
  if (Array.isArray(parsed)) {
    const firstEntry = parsed[0];
    const firstUrl = firstEntry && typeof firstEntry === "object" && "url" in firstEntry
      ? String(firstEntry.url)
      : "";
    const match = firstUrl.match(/\/projects\/([^/]+)/);

    return {
      meta: { projectSlug: match?.[1] ?? "test-project", recordedAt: "" },
      entries: parsed as VCREntry[],
    };
  }

  if (parsed && typeof parsed === "object" && "entries" in parsed) {
    return parsed as VCRCassette;
  }

  return undefined;
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
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<{ client: ApiClient; save: () => Promise<void>; projectSlug: string }> {
  const fs = createFileSystem();
  const recording = env.vcr === "record";
  const fixturesDir = new URL("../commands/fixtures", import.meta.url).pathname;
  const cassettePath = `${fixturesDir}/${cassetteName}.json`;

  let cassette: VCRCassette = {
    meta: { projectSlug: projectSlug ?? "", recordedAt: "" },
    entries: [],
  };

  const usedIndices = new Set<number>();

  if (recording) {
    if (!projectSlug) throw new Error("projectSlug required for VCR=record mode");
    cassette.meta = { projectSlug, recordedAt: new Date().toISOString() };
  } else {
    try {
      const content = await fs.readTextFile(cassettePath);
      const parsed = parseCassette(JSON.parse(content));
      if (parsed) cassette = parsed;
    } catch {
      throw new Error(`Cassette not found: ${cassettePath}\nRun with VCR=record to create it.`);
    }
  }

  function findEntry(method: string, url: string): VCREntry | undefined {
    for (let i = 0; i < cassette.entries.length; i++) {
      if (usedIndices.has(i)) continue;

      const entry = cassette.entries[i];
      if (!entry) continue;
      if (entry.method !== method || entry.url !== url) continue;

      usedIndices.add(i);
      return entry;
    }
    return undefined;
  }

  async function recordOrReplay<T>(
    method: string,
    url: string,
    body: unknown,
    realCall: () => Promise<T>,
  ): Promise<T> {
    if (recording) {
      if (!realClient) throw new Error("Real client required for VCR=record mode");
      const response = await realCall();
      cassette.entries.push({ method, url, body, response });
      return response;
    }

    const entry = findEntry(method, url);
    if (!entry) throw new Error(`No recorded response for: ${method.toUpperCase()} ${url}`);
    return entry.response as T;
  }

  function requireRealClient(): ApiClient {
    if (!realClient) throw new Error("Real client required for VCR=record mode");
    return realClient;
  }

  const client: ApiClient = {
    get<T>(url: string, params?: Record<string, string>): Promise<T> {
      return recordOrReplay("get", url, params, () => requireRealClient().get<T>(url, params));
    },
    post<T>(url: string, body?: unknown): Promise<T> {
      return recordOrReplay("post", url, body, () => requireRealClient().post<T>(url, body));
    },
    put<T>(url: string, body?: unknown): Promise<T> {
      return recordOrReplay("put", url, body, () => requireRealClient().put<T>(url, body));
    },
    patch<T>(url: string, body?: unknown): Promise<T> {
      return recordOrReplay("patch", url, body, () => requireRealClient().patch<T>(url, body));
    },
    delete<T>(url: string): Promise<T> {
      return recordOrReplay("delete", url, undefined, () => requireRealClient().delete<T>(url));
    },
  };

  async function save(): Promise<void> {
    if (!recording || cassette.entries.length === 0) return;

    await fs.mkdir(fixturesDir, { recursive: true });
    await fs.writeTextFile(cassettePath, `${JSON.stringify(cassette, null, 2)}\n`);
    cliLogger.info(`Saved cassette: ${cassettePath} (${cassette.entries.length} entries)`);
  }

  return { client, save, projectSlug: cassette.meta.projectSlug };
}

/**
 * Check if running in record mode
 */
export function isRecording(env: RuntimeEnv = getRuntimeEnv()): boolean {
  return env.vcr === "record";
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
 */
export async function initVCRTest(
  cassetteName: string,
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<VCRTestContext> {
  if (!isRecording(env)) {
    const vcr = await createVCRClient(cassetteName);
    return { client: vcr.client, projectSlug: vcr.projectSlug, save: vcr.save };
  }

  if (!env.projectSlug) throw new Error("VCR=record requires VERYFRONT_PROJECT_SLUG");

  // Dynamic import to avoid loading config module in playback mode
  const { createApiClient, resolveConfig } = await import("../shared/config.ts");
  const config = await resolveConfig(cwd());
  const realClient = createApiClient(config);
  const vcr = await createVCRClient(cassetteName, realClient, env.projectSlug, env);

  return { client: vcr.client, projectSlug: vcr.projectSlug, save: vcr.save };
}
