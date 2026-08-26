import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DiscoveryConfig, DiscoveryResult } from "#veryfront/discovery/types.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
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

/** Placeholder base dir: recorder() never touches the filesystem. */
const PROJECT_DIR = "<PROJECT_DIR>";
const dedicatedRuntimeAdapter = {} as RuntimeAdapter;

/** No adapter is extended, so discovery takes the unscoped branch. */
const noExtendedAdapters = (_fs: FileSystemAdapter): _fs is ExtendedFileSystemAdapter => false;

/** Every adapter is extended, so discovery takes the scoped branch. */
const allExtendedAdapters = (_fs: FileSystemAdapter): _fs is ExtendedFileSystemAdapter => true;

describe("server/startup-discovery", () => {
  it("denies host execution when the deployment does not grant it", async () => {
    const { calls, discoverAll } = recorder();

    await runStartupDiscovery({
      config: { baseDir: PROJECT_DIR },
      runtimeAdapter: dedicatedRuntimeAdapter,
      allowHostProjectCodeExecution: false,
      discoverAll,
      isExtendedFSAdapter: noExtendedAdapters,
    });

    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.allowHostProjectCodeExecution, false);
    assertEquals(
      calls[0]?.baseDir,
      PROJECT_DIR,
      "discovery must receive the configured project dir",
    );
  });

  it("forwards the configured adapter and verbose flag to discovery", async () => {
    const { calls, discoverAll } = recorder();
    const fsAdapter = {} as unknown as FileSystemAdapter;

    await runStartupDiscovery({
      config: { baseDir: PROJECT_DIR, fsAdapter, verbose: true },
      runtimeAdapter: dedicatedRuntimeAdapter,
      allowHostProjectCodeExecution: false,
      discoverAll,
      isExtendedFSAdapter: noExtendedAdapters,
    });

    assertEquals(
      calls[0]?.baseDir,
      PROJECT_DIR,
      "discovery must receive the configured project dir",
    );
    assertStrictEquals(
      calls[0]?.fsAdapter,
      fsAdapter,
      "discovery must receive the configured adapter",
    );
    assertEquals(calls[0]?.verbose, true, "the verbose flag must be forwarded");
  });

  it("defaults the verbose flag to false", async () => {
    const { calls, discoverAll } = recorder();

    await runStartupDiscovery({
      config: { baseDir: PROJECT_DIR },
      runtimeAdapter: dedicatedRuntimeAdapter,
      allowHostProjectCodeExecution: false,
      discoverAll,
      isExtendedFSAdapter: noExtendedAdapters,
    });

    assertEquals(calls[0]?.verbose, false, "verbose defaults to false");
  });

  it("runs discovery for a single-project extended adapter", async () => {
    const { calls, discoverAll } = recorder();
    const fsAdapter = {
      isMultiProjectMode: () => false,
      runWithContext: <T>(_slug: string, _token: string, fn: () => Promise<T>) => fn(),
    } as unknown as ExtendedFileSystemAdapter;

    const outcome = await runStartupDiscovery({
      config: { baseDir: PROJECT_DIR, projectSlug: "p", apiToken: "t", fsAdapter },
      runtimeAdapter: dedicatedRuntimeAdapter,
      allowHostProjectCodeExecution: true,
      discoverAll,
      isExtendedFSAdapter: allExtendedAdapters,
    });

    assertEquals(
      outcome,
      { ran: true },
      "a single-project extended adapter is not the scoped multi-project path and must still run startup discovery",
    );
    assertEquals(calls.length, 1, "discovery must be invoked exactly once");
    assertEquals(
      calls[0]?.allowHostProjectCodeExecution,
      true,
      "the computed grant is forwarded unchanged",
    );
  });

  it("grants host execution when the deployment does", async () => {
    const { calls, discoverAll } = recorder();

    await runStartupDiscovery({
      config: { baseDir: PROJECT_DIR },
      runtimeAdapter: dedicatedRuntimeAdapter,
      allowHostProjectCodeExecution: true,
      discoverAll,
      isExtendedFSAdapter: noExtendedAdapters,
    });

    assertEquals(calls[0]?.allowHostProjectCodeExecution, true);
  });

  it("forwards the deployment grant to unscoped discovery in a shared runtime", async () => {
    // The entrypoint's posture already honoured the operator grant
    // (veryfront-issue-inbox#848), and the topology re-check here must not
    // discard it a second time: startup discovery and request handling share
    // one computed value.
    const { calls, discoverAll } = recorder();
    const runtimeAdapter = {
      fs: { isMultiProjectMode: () => true },
    } as unknown as RuntimeAdapter;

    await runStartupDiscovery({
      config: { baseDir: PROJECT_DIR },
      runtimeAdapter,
      allowHostProjectCodeExecution: true,
      discoverAll,
      isExtendedFSAdapter: noExtendedAdapters,
    });

    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.allowHostProjectCodeExecution, true);
  });

  it("denies host execution for ungranted unscoped discovery in a shared runtime", async () => {
    const { calls, discoverAll } = recorder();
    const runtimeAdapter = {
      fs: { isMultiProjectMode: () => true },
    } as unknown as RuntimeAdapter;

    await runStartupDiscovery({
      config: { baseDir: PROJECT_DIR },
      runtimeAdapter,
      allowHostProjectCodeExecution: false,
      discoverAll,
      isExtendedFSAdapter: noExtendedAdapters,
    });

    assertEquals(calls.length, 1);
    assertEquals(
      calls[0]?.allowHostProjectCodeExecution,
      false,
      "a shared runtime without a grant must stay fail-closed at startup",
    );
  });

  it("skips the scoped multi-project path rather than calling discovery ungranted", async () => {
    const { calls, discoverAll } = recorder();
    const fsAdapter = {
      isMultiProjectMode: () => true,
      runWithContext: <T>(_slug: string, _token: string, fn: () => Promise<T>) => fn(),
    } as unknown as ExtendedFileSystemAdapter;

    const outcome = await runStartupDiscovery({
      // Even with the deployment granting, the scoped branch must not pass it:
      // that path evaluates tenant source under a project context.
      config: { baseDir: PROJECT_DIR, projectSlug: "p", apiToken: "t", fsAdapter },
      runtimeAdapter: dedicatedRuntimeAdapter,
      allowHostProjectCodeExecution: true,
      discoverAll,
      isExtendedFSAdapter: allExtendedAdapters,
    });

    assertEquals(outcome, { ran: false, reason: "scoped-multi-project" });
    assertEquals(calls.length, 0);
  });

  it("never calls discovery in a way the real implementation would reject", async () => {
    // The stub above accepts any config, but the real `discoverAll` throws on
    // an ungranted one (`discovery-engine.ts`, "Executable project discovery
    // requires explicit trusted-local execution"). A permissive stub is why the
    // scoped branch could call it ungranted on every startup while the suite
    // stayed green, so this stub enforces the same rule the real one does.
    const enforcing = (config: DiscoveryConfig) => {
      if (config.allowHostProjectCodeExecution !== true) {
        return Promise.reject(
          new TypeError("Executable project discovery requires explicit trusted-local execution"),
        );
      }
      return Promise.resolve(emptyResult());
    };
    const fsAdapter = {
      isMultiProjectMode: () => true,
      runWithContext: <T>(_slug: string, _token: string, fn: () => Promise<T>) => fn(),
    } as unknown as ExtendedFileSystemAdapter;

    // Scoped: must skip, so the enforcing stub is never reached.
    assertEquals(
      await runStartupDiscovery({
        config: { baseDir: PROJECT_DIR, projectSlug: "p", apiToken: "t", fsAdapter },
        runtimeAdapter: dedicatedRuntimeAdapter,
        allowHostProjectCodeExecution: true,
        discoverAll: enforcing,
        isExtendedFSAdapter: allExtendedAdapters,
      }),
      { ran: false, reason: "scoped-multi-project" },
    );

    // Unscoped and granted: must reach discovery and be accepted.
    assertEquals(
      await runStartupDiscovery({
        config: { baseDir: PROJECT_DIR },
        runtimeAdapter: dedicatedRuntimeAdapter,
        allowHostProjectCodeExecution: true,
        discoverAll: enforcing,
        isExtendedFSAdapter: noExtendedAdapters,
      }),
      { ran: true },
    );
  });
});
