import "../../../_helpers/contract-init.ts";
import type { DataContext } from "#veryfront/data/index.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";

type StaticDataContext = Omit<DataContext, "request" | "query">;

export type { StaticDataContext };

export function withProductionContext<T>(fn: () => T | Promise<T>): T | Promise<T> {
  return runWithCacheKeyContext(
    { projectId: "test-project", mode: "production", versionId: "rel_test" },
    fn,
  );
}

export function makeContext(
  url: string,
  params: Record<string, string | string[]> = {},
): DataContext {
  const parsedUrl = new URL(url);
  return {
    params,
    query: parsedUrl.searchParams,
    request: new Request(url),
    url: parsedUrl,
  };
}

// deno-lint-ignore no-explicit-any -- small test helper for typed property access
export function getProp<T>(obj: any, key: string): T {
  return obj?.[key];
}
