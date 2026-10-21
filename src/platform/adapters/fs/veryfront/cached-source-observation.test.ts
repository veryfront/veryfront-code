import { MultiProjectFSAdapter } from "./multi-project-adapter.ts";
import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertExists, assertNotEquals } from "#veryfront/testing/assert.ts";
import { createHash } from "node:crypto";
import { observeCachedSource, registerCachedSourceObserver } from "../cached-source-observation.ts";
import { createAdapter } from "./adapter.test-helpers.ts";
import { FSAdapterWrapper } from "../wrapper.ts";
async function seeded(files: { path: string; content?: string }[]) {
  const adapter = createAdapter();
  adapter.setContentContext({
    sourceType: "branch",
    projectSlug: "test-project",
    branch: "sample",
  });
  const client = adapter as unknown as {
    client: {
      initialize: () => Promise<void>;
      getProjectSlug: () => string;
      getProjectId: () => string;
      getCachedProject: () => { provider: string; layout: string };
      listAllFiles: () => Promise<typeof files>;
    };
  };
  client.client.initialize = () => Promise.resolve();
  client.client.getProjectSlug = () => "test-project";
  client.client.getProjectId = () => "10000000-1000-4000-8000-100000000001";
  client.client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
  client.client.listAllFiles = () => Promise.resolve(files);
  await adapter.initialize();
  return adapter;
}
describe("cached source observation", () => {
  it("does not initialize an unavailable cache or trust public reader-looking properties", async () => {
    assertEquals(await observeCachedSource(createAdapter()), undefined);
    assertEquals(
      await observeCachedSource({ getCachedSourceSnapshotReceipt: () => "forged" }),
      undefined,
    );
  });
  it("hashes all cached members and forwards only the concrete private reader", async () => {
    const files = Array.from(
      { length: 46 },
      (_, i) => ({
        path: `source-${String(i).padStart(2, "0")}.ts`,
        content: `export const value = ${i}`,
      }),
    );
    const adapter = await seeded(files);
    const result = await observeCachedSource(new FSAdapterWrapper(adapter));
    assertExists(result);
    assertEquals(result.members.length, 46);
    assertEquals(
      result.members[45]!.sha256,
      createHash("sha256").update(files[45]!.content).digest("hex"),
    );
    files[45]!.content += "changed";
    assertNotEquals(
      (await observeCachedSource(adapter))?.members[45]?.sha256,
      result.members[45]!.sha256,
    );
  });
  for (
    const files of [
      [],
      [{ path: "a" }],
      [{ path: "../a", content: "x" }],
      [{ path: "a", content: "x" }, { path: "/a", content: "x" }],
      Array.from({ length: 257 }, (_, i) => ({ path: `${i}.ts`, content: "x" })),
    ]
  ) {
    it("rejects missing text, invalid membership or bounds", async () => {
      assertEquals(await observeCachedSource(await seeded(files)), undefined);
    });
  }
  it("rejects cache movement while the fingerprint is hashing", async () => {
    const adapter = await seeded([{ path: "a.ts", content: "x" }]);
    const pending = observeCachedSource(adapter);
    adapter.setRequestBranch("different-branch");
    assertEquals(await pending, undefined);
  });
});

Deno.test("unselected multi-project cache observation does not materialize an adapter", async () => {
  const adapter = new MultiProjectFSAdapter({
    veryfront: {
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache: { enabled: false },
    },
  });
  try {
    const before = adapter.getManagerStats();
    assertEquals(await observeCachedSource(adapter), undefined);
    await adapter.runWithContext(
      "test-project",
      "test-token",
      async () => {
        assertEquals(await observeCachedSource(adapter), undefined);
      },
      "10000000-1000-4000-8000-100000000005",
      { branch: "sample" },
    );
    assertEquals(adapter.getManagerStats(), before);
  } finally {
    adapter.dispose();
  }
});

Deno.test("project imports cannot replace a constructor-bound concrete or wrapper reader", async () => {
  const adapter = await seeded([{ path: "real.ts", content: "actual cached bytes" }]);
  const wrapper = new FSAdapterWrapper(adapter);
  let forgedReads = 0;
  const forged = () => {
    forgedReads++;
    return Promise.resolve(undefined);
  };
  registerCachedSourceObserver(adapter, forged);
  registerCachedSourceObserver(wrapper, forged);
  assertEquals((await observeCachedSource(adapter))?.members[0]?.path, "real.ts");
  assertEquals((await observeCachedSource(wrapper))?.members[0]?.path, "real.ts");
  assertEquals(forgedReads, 0);
});

Deno.test("writable cache lookalikes cannot replace host-owned source state", async () => {
  const adapter = await seeded([{ path: "real.ts", content: "actual cached bytes" }]);
  const before = await observeCachedSource(adapter);
  assertExists(before);
  Object.assign(adapter, {
    sourceSnapshotFiles: [{ path: "forged.ts", content: "project-selected bytes" }],
    sourceSnapshotVersion: -1,
    sourceSnapshotIdentity: "forged-source",
    markSourceSnapshotChanged: () => {},
    replaceSourceSnapshot: () => Promise.resolve(-1),
  });
  assertEquals(await observeCachedSource(adapter), before);
  assertEquals(adapter.getSourceSnapshotVersion(), before.version);
});
