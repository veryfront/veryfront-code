import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deriveDefaultRendererProjectId, mergeRendererConfig } from "./ssr.ts";

describe("rendering/orchestrator/ssr", () => {
  it("derives deterministic, collision-resistant default project identities", async () => {
    const first = await deriveDefaultRendererProjectId("/project-1n");
    const repeated = await deriveDefaultRendererProjectId("/project-1n");
    const legacyCollision = await deriveDefaultRendererProjectId("/project-30");

    assertEquals(first, repeated);
    assertNotEquals(first, legacyCollision);
    assertEquals(/^proj_[a-f0-9]{64}$/.test(first), true);
  });

  it("applies the legacy renderer directory override without dropping config", () => {
    assertEquals(
      mergeRendererConfig(
        {
          title: "Project",
          directories: {
            pages: "content/pages",
            ai: "agents",
          },
        },
        {
          app: "src/app",
          components: ["src/components"],
        },
      ),
      {
        title: "Project",
        directories: {
          pages: "content/pages",
          ai: "agents",
          app: "src/app",
          components: ["src/components"],
        },
      },
    );
  });
});
