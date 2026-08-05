import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runStartupDiscovery } from "./startup-discovery.ts";

type DiscoverCall = { allowHostProjectCodeExecution?: boolean; baseDir: string };

function recorder() {
  const calls: DiscoverCall[] = [];
  return { calls, discoverAll: (input: DiscoverCall) => (calls.push(input), Promise.resolve()) };
}

describe("server/startup-discovery", () => {
  it("denies host execution when the deployment does not grant it", async () => {
    const { calls, discoverAll } = recorder();

    await runStartupDiscovery({
      config: { baseDir: "/app" },
      allowHostProjectCodeExecution: false,
      discoverAll,
      isExtendedFSAdapter: () => false,
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
      isExtendedFSAdapter: () => false,
    });

    assertEquals(calls[0]?.allowHostProjectCodeExecution, true);
  });

  it("keeps the scoped multi-project path ungranted", async () => {
    const { calls, discoverAll } = recorder();
    const fsAdapter = {
      isMultiProjectMode: () => true,
      runWithContext: (_s: string, _t: string, fn: () => Promise<void>) => fn(),
    };

    await runStartupDiscovery({
      config: { baseDir: "/app", projectSlug: "p", apiToken: "t", fsAdapter } as never,
      // Even with the deployment granting, the scoped branch must not pass it:
      // that path evaluates tenant source under a project context.
      allowHostProjectCodeExecution: true,
      discoverAll,
      isExtendedFSAdapter: () => true,
    });

    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.allowHostProjectCodeExecution, undefined);
  });
});
