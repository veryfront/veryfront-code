import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseHydrationManifest } from "./hydration-manifest.ts";

describe("rendering/rsc/hydration-manifest", () => {
  it("snapshots a valid manifest without retaining mutable input containers", () => {
    const source = {
      version: 1,
      hash: "revision-a",
      components: {
        Counter: "/_veryfront/rsc/module?rel=Counter.tsx",
      },
      modules: [{
        id: "Counter",
        clientRef: "/app/Counter.tsx#default",
        exports: ["default"],
      }],
      graphIds: {
        client: [{
          id: "Counter",
          path: "Counter.tsx",
          rel: "/Counter.tsx",
        }],
        server: [],
      },
    };

    const manifest = parseHydrationManifest(source);
    source.modules[0]!.exports[0] = "mutated";
    source.graphIds.client[0]!.rel = "/mutated.tsx";

    assertEquals(manifest?.modules[0]?.exports, ["default"]);
    assertEquals(manifest?.graphIds?.client[0]?.rel, "/Counter.tsx");
  });

  it("rejects duplicate and structurally ambiguous manifest identities", () => {
    assertEquals(
      parseHydrationManifest({
        version: 1,
        hash: "revision-a",
        modules: [
          { id: "Counter", clientRef: "/app/Counter.tsx#default", exports: ["default"] },
          { id: "Counter", clientRef: "/app/Other.tsx#default", exports: ["default"] },
        ],
      }),
      null,
    );
    assertEquals(
      parseHydrationManifest({
        version: 1,
        hash: "revision-a",
        modules: [],
        graphIds: {
          client: [
            { id: "one", path: "one.tsx", rel: "/same.tsx" },
            { id: "two", path: "two.tsx", rel: "/same.tsx" },
          ],
          server: [],
        },
      }),
      null,
    );
  });

  it("rejects oversized manifests before they reach dynamic import resolution", () => {
    assertEquals(
      parseHydrationManifest({
        version: 1,
        hash: "revision-a",
        modules: Array.from(
          { length: 100_001 },
          (_, index) => ({
            id: `component-${index}`,
            clientRef: `/app/component-${index}.tsx#default`,
            exports: ["default"],
          }),
        ),
      }),
      null,
    );
  });
});
