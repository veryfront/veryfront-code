import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RSCEndpointParams } from "./types.ts";

/** Minimal mock adapter with fs operations for module endpoint tests */
export function createMockAdapter(
  fsOverrides: {
    knownFiles?: readonly string[];
    exists?: (path: string) => Promise<boolean>;
    readFile?: (path: string) => Promise<string>;
    stat?: (path: string) => Promise<{
      isFile: boolean;
      isDirectory: boolean;
      size: number;
      mtime: Date | null;
    }>;
    readDir?: (path: string) => AsyncIterable<{
      name: string;
      isFile: boolean;
      isDirectory: boolean;
      isSymlink: boolean;
    }>;
  } = {},
): RuntimeAdapter {
  return {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: fsOverrides.exists ?? (() => Promise.resolve(false)),
      readFile: fsOverrides.readFile ?? (() => Promise.resolve("")),
      writeFile: () => Promise.resolve(),
      readDir: fsOverrides.readDir ?? createKnownFilesReader(fsOverrides.knownFiles ?? []),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: fsOverrides.stat ?? (async (path: string) => {
        if (await (fsOverrides.exists?.(path) ?? Promise.resolve(false))) {
          return { isFile: true, isDirectory: false, size: 0, mtime: null };
        }
        throw new Deno.errors.NotFound("not found");
      }),
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: {
      createHandler: () => () => new Response(),
    },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

function createKnownFilesReader(
  knownFiles: readonly string[],
): (path: string) => AsyncIterable<{
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}> {
  return async function* (directory: string) {
    const prefix = directory.replace(/\/+$/, "") + "/";
    const entries = new Map<string, boolean>();
    for (const file of knownFiles) {
      if (!file.startsWith(prefix)) continue;
      const remainder = file.slice(prefix.length);
      if (!remainder) continue;
      const separator = remainder.indexOf("/");
      const name = separator === -1 ? remainder : remainder.slice(0, separator);
      entries.set(name, separator !== -1);
    }

    for (const [name, isDirectory] of entries) {
      yield {
        name,
        isFile: !isDirectory,
        isDirectory,
        isSymlink: false,
      };
    }
  };
}

/** Config with RSC enabled */
export const rscEnabledConfig: VeryfrontConfig = {
  experimental: { rsc: true },
} as unknown as VeryfrontConfig;

/** Config with RSC disabled */
export const rscDisabledConfig: VeryfrontConfig = {
  experimental: { rsc: false },
} as unknown as VeryfrontConfig;

/** Config with no experimental section */
export const noExperimentalConfig: VeryfrontConfig = {} as unknown as VeryfrontConfig;

export function makeParams(
  overrides: Partial<RSCEndpointParams> & { pathname: string },
): RSCEndpointParams {
  return {
    projectDir: overrides.projectDir ?? "/tmp/test-project",
    adapter: overrides.adapter ?? createMockAdapter(),
    config: overrides.config,
    ...overrides,
    req: overrides.req ?? new Request("http://localhost" + overrides.pathname),
  };
}
