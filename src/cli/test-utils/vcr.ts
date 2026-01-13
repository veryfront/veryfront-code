/**
 * Simple VCR (Video Cassette Recorder) for API testing
 *
 * Record:  deno task test:vcr:record
 * Replay:  deno task test:vcr (default)
 *
 * @module cli/test-utils/vcr
 */

import { load } from "jsr:@std/dotenv@0.225";
import type { ApiClient } from "../shared/config.ts";

// Load .env.local for credentials in record mode
await load({ envPath: ".env.local", export: true });

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

const FIXTURES_DIR = "./src/cli/commands/fixtures";

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
  const recording = Deno.env.get("VCR") === "record";
  const cassettePath = `${FIXTURES_DIR}/${cassetteName}.json`;

  let cassette: VCRCassette = {
    meta: { projectSlug: projectSlug || "", recordedAt: "" },
    entries: [],
  };
  const usedIndices = new Set<number>();

  // Load existing cassette for playback
  if (!recording) {
    try {
      const content = await Deno.readTextFile(cassettePath);
      const parsed = JSON.parse(content);
      // Handle both old (array) and new (object with meta) format
      if (Array.isArray(parsed)) {
        // Extract project slug from first URL
        const firstUrl = parsed[0]?.url || "";
        const match = firstUrl.match(/\/projects\/([^/]+)/);
        cassette = {
          meta: { projectSlug: match?.[1] || "unknown", recordedAt: "" },
          entries: parsed,
        };
      } else {
        cassette = parsed;
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
  const findEntry = (method: string, url: string): VCREntry | undefined => {
    for (let i = 0; i < cassette.entries.length; i++) {
      const entry = cassette.entries[i]!;
      if (!usedIndices.has(i) && entry.method === method && entry.url === url) {
        usedIndices.add(i);
        return entry;
      }
    }
    return undefined;
  };

  // Create handler for each HTTP method
  const handler =
    (method: string) =>
    async <T>(url: string, body?: unknown): Promise<T> => {
      if (recording) {
        if (!realClient) {
          throw new Error("Real client required for VCR=record mode");
        }
        const clientAny = realClient as unknown as Record<string, (url: string, body?: unknown) => Promise<unknown>>;
        const response = await clientAny[method]!(url, body);
        cassette.entries.push({ method, url, body, response });
        return response as T;
      } else {
        const entry = findEntry(method, url);
        if (!entry) {
          throw new Error(`No recorded response for: ${method.toUpperCase()} ${url}`);
        }
        return entry.response as T;
      }
    };

  const client: ApiClient = {
    get: handler("get"),
    post: handler("post"),
    put: handler("put"),
    patch: handler("patch"),
    delete: handler("delete"),
  } as ApiClient;

  const save = async () => {
    if (recording && cassette.entries.length > 0) {
      await Deno.mkdir(FIXTURES_DIR, { recursive: true });
      await Deno.writeTextFile(
        cassettePath,
        JSON.stringify(cassette, null, 2) + "\n",
      );
      console.log(`Saved cassette: ${cassettePath} (${cassette.entries.length} entries)`);
    }
  };

  return { client, save, projectSlug: cassette.meta.projectSlug };
}

/**
 * Check if running in record mode
 */
export function isRecording(): boolean {
  return Deno.env.get("VCR") === "record";
}
