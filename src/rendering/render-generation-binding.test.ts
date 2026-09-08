import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RenderGeneration } from "./render-generation.ts";
import { RenderGenerationPool } from "./render-generation-pool.ts";
import {
  type RenderGenerationBinding,
  resolveRenderGenerationIdentity,
} from "./render-generation-binding.ts";

const binding = (): RenderGenerationBinding => ({
  projectId: "project-one",
  environmentId: "preview",
  sourceSnapshotId: "source-one",
  configurationId: "configuration-one",
  dependencySnapshotId: "dependencies-one",
  artifactId: "artifacts-one",
  frameworkId: "framework-one",
  runtimeId: "deno-test",
  executionPolicyId: "policy-one",
});

describe("render generation binding", () => {
  it("produces the same bounded frozen identity from independent copies", async () => {
    const first = await resolveRenderGenerationIdentity(binding());
    const second = await resolveRenderGenerationIdentity({ ...binding() });
    assertEquals(first, second);
    assertEquals(first, {
      scopeId: "d1f4e59c809a7600f08cc9b738e04eda45b9b09b4189b0a1440d144cd8b27730",
      generationId: "c5f732ad26027ce9d6b5c276b1a7f638d68bf2f3b45c723db07d80153f8bbaeb",
    });
    assertEquals(Object.isFrozen(first), true);
    assertEquals(first.scopeId.length, 64);
    assertEquals(first.generationId.length, 64);
    assertEquals(JSON.stringify(first).includes("project-one"), false);
  });

  for (const field of Object.keys(binding()) as (keyof RenderGenerationBinding)[]) {
    it(`does not reuse a generation when ${field} changes`, async () => {
      const original = binding();
      const first = await resolveRenderGenerationIdentity(original);
      const changed = await resolveRenderGenerationIdentity({ ...original, [field]: "changed" });
      assertNotEquals(first.generationId, changed.generationId);
      assertEquals(
        first.scopeId === changed.scopeId,
        field !== "projectId" && field !== "environmentId",
      );
    });
  }

  it("snapshots every input before hashing yields", async () => {
    const original = binding();
    const pending = resolveRenderGenerationIdentity(original);
    Object.assign(original, { sourceSnapshotId: "replacement", executionPolicyId: "replacement" });
    assertEquals(await pending, await resolveRenderGenerationIdentity(binding()));
  });

  it("frames field boundaries and preserves Unicode without normalization", async () => {
    const first = { ...binding(), projectId: "a", environmentId: "b:c" };
    const second = { ...binding(), projectId: "a:b", environmentId: "c" };
    assertNotEquals(
      await resolveRenderGenerationIdentity(first),
      await resolveRenderGenerationIdentity(second),
    );
    assertNotEquals(
      await resolveRenderGenerationIdentity({ ...binding(), sourceSnapshotId: "é" }),
      await resolveRenderGenerationIdentity({ ...binding(), sourceSnapshotId: "e\u0301" }),
    );
  });

  it("rejects incomplete, extra, inherited, and invalid fields", async () => {
    for (const field of Object.keys(binding())) {
      for (const value of [undefined, null, "", 1, "x".repeat(1025), "\ud800"]) {
        await assertRejects(
          () =>
            resolveRenderGenerationIdentity(
              { ...binding(), [field]: value } as RenderGenerationBinding,
            ),
          TypeError,
          "Render generation binding",
        );
      }
    }
    for (
      const value of [null, [], Object.create(binding()), { ...binding(), extra: "unsupported" }]
    ) {
      await assertRejects(
        () => resolveRenderGenerationIdentity(value as RenderGenerationBinding),
        TypeError,
        "Render generation binding",
      );
    }
    await resolveRenderGenerationIdentity({ ...binding(), sourceSnapshotId: "x".repeat(1024) });
  });

  it("rejects accessors and proxies without executing their hooks", async () => {
    let hooks = 0;
    const accessor = {
      ...binding(),
      get sourceSnapshotId() {
        hooks++;
        return "source-one";
      },
    };
    const proxy = new Proxy(binding(), {
      getOwnPropertyDescriptor() {
        hooks++;
        throw new Error("hook");
      },
    });
    for (const value of [accessor, proxy]) {
      await assertRejects(
        () => resolveRenderGenerationIdentity(value),
        TypeError,
        "Render generation binding",
      );
    }
    assertEquals(hooks, 0);
  });

  it("reuses exact bindings locally while separate replicas retain independent owners", async () => {
    const pools = [0, 1].map(() =>
      new RenderGenerationPool({ maxGenerations: 2, maxConcurrentRenders: 1 })
    );
    const created = [0, 0];
    const oldIdentity = await resolveRenderGenerationIdentity(binding());
    const newIdentity = await resolveRenderGenerationIdentity({
      ...binding(),
      configurationId: "configuration-two",
    });
    const request = () => new Request("http://localhost/page");
    const create = (replica: number, text: string) => () => {
      created[replica]!++;
      return new RenderGeneration({
        executor: { render: async () => new Response(text), stop: async () => {} },
        releaseArtifacts: async () => {},
        maxConcurrentRenders: 1,
        drainTimeoutMs: 0,
      });
    };
    try {
      for (const [replica, pool] of pools.entries()) {
        assertEquals(
          await (await pool.render(request(), oldIdentity, create(replica, "old"))).text(),
          "old",
        );
        assertEquals(
          await (await pool.render(
            request(),
            await resolveRenderGenerationIdentity(binding()),
            create(replica, "unexpected"),
          )).text(),
          "old",
        );
      }
      assertEquals(
        await (await pools[0]!.render(request(), newIdentity, create(0, "new"))).text(),
        "new",
      );
      await pools[0]!.retire(oldIdentity);
      assertEquals(
        await (await pools[1]!.render(request(), oldIdentity, create(1, "unexpected"))).text(),
        "old",
      );
      assertEquals(created, [2, 1]);
    } finally {
      await Promise.all(pools.map((pool) => pool.close()));
    }
  });
});
