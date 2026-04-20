import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RSCEndpointParams } from "./types.ts";

/** Minimal mock adapter with fs operations for module endpoint tests */
export function createMockAdapter(
  fsOverrides: {
    exists?: (path: string) => Promise<boolean>;
    readFile?: (path: string) => Promise<string>;
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
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: () => Promise.resolve({ isFile: true, isDirectory: false, size: 0, mtime: null }),
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
