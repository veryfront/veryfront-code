import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DiscoveryConfig, DiscoveryResult } from "#veryfront/discovery/types.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ExtendedFileSystemAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { runStartupDiscovery } from "./startup-discovery.ts";

function emptyResult(): DiscoveryResult {
  return {
    tools: new Map(),
    agents: new Map(),
    skills: new Map(),
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
    tasks: new Map(),
    schedules: new Map(),
    webhooks: new Map(),
    evals: new Map(),
    errors: [],
  };
}

function recorder() {
  const calls: DiscoveryConfig[] = [];
  return {
    calls,
    discoverAll: (config: DiscoveryConfig) => {
      calls.push(config);
      return Promise.resolve(emptyResult());
    },
  };
}

/** No adapter is extended, so discovery takes the unscoped branch. */
const noExtendedAdapters = (_fs: FileSystemAdapter): _fs is ExtendedFileSystemAdapter => false;

/** Every adapter is extended, so discovery takes the scoped branch. */
const allExtendedAdapters = (_fs: FileSystemAdapter): _fs is ExtendedFileSystemAdapter => true;

describe("server/startup-discovery", () => {
  it("denies host execution when the deployment does not grant it", async () => {
    const { calls, discoverAll } = recorder();

    await runStartupDiscovery({
      config: { baseDir: "/app" },
      allowHostProjectCodeExecution: false,
      discoverAll,
      isExtendedFSAdapter: noExtendedAdapters,
    });

    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.allowHostProjectCodeExecution, false);
  });

  it("grants host execution when the deployment does", async () => {
    const { calls, discoverAll } = recorder();

    await runStartupDiscovery({
      config: { baseDir: "/app" },
      allowHostProjectCodeExecution: true,
      discoverAll,
      isExtendedFSAdapter: noExtendedAdapters,
    });

    assertEquals(calls[0]?.allowHostProjectCodeExecution, true);
  });

  it("keeps the scoped multi-project path ungranted", async () => {
    const { calls, discoverAll } = recorder();
    const fsAdapter = {
      isMultiProjectMode: () => true,
      runWithContext: <T>(_slug: string, _token: string, fn: () => Promise<T>) => fn(),
    } as unknown as ExtendedFileSystemAdapter;

    await runStartupDiscovery({
      config: { baseDir: "/app", projectSlug: "p", apiToken: "t", fsAdapter },
      // Even with the deployment granting, the scoped branch must not pass it:
      // that path evaluates tenant source under a project context.
      allowHostProjectCodeExecution: true,
      discoverAll,
      isExtendedFSAdapter: allExtendedAdapters,
    });

    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.allowHostProjectCodeExecution, undefined);
  });
});
