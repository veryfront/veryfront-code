import { buildFileListCacheKey } from "./cache-keys.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import type { FSAdapterConfig } from "./types.ts";

export function createAdapter(
  overrides: Partial<FSAdapterConfig> = {},
): VeryfrontFSAdapter {
  return new VeryfrontFSAdapter({
    veryfront: {
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache: { enabled: false },
    },
    ...overrides,
  });
}

export function seedCachedFiles(
  adapter: VeryfrontFSAdapter,
  files: Array<{ id?: string; path: string; content?: string }>,
): void {
  const context = adapter.getContentContext();
  if (!context) throw new Error("Content context required before seeding cache");

  const cacheKey = buildFileListCacheKey(context);
  (adapter as unknown as {
    cache: {
      set: (
        key: string,
        value: Array<{ id?: string; path: string; content?: string }>,
      ) => void;
    };
  }).cache.set(cacheKey, files);
}

export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for condition");
}
