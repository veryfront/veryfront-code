import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { publishPackages } from "./publish-rc-packages.ts";

describe("bounded RC publication", () => {
  it("publishes independent extensions together, dependencies first and root last", async () => {
    const started: string[] = [];
    const completed = new Set<string>();
    let active = 0;
    let peak = 0;
    await publishPackages([
      { name: "base", directory: "base", dependencies: [] },
      { name: "dependent", directory: "dependent", dependencies: ["base"] },
      ...Array.from(
        { length: 5 },
        (_, i) => ({
          name: `sibling${i}`,
          directory: `sibling${i}`,
          dependencies: [],
        }),
      ),
      { name: "veryfront", directory: "npm", dependencies: ["dependent"] },
    ], async (entry) => {
      if (entry.name === "dependent") assertEquals(completed.has("base"), true);
      if (entry.name === "veryfront") assertEquals(completed.size, 7);
      active++;
      peak = Math.max(peak, active);
      started.push(entry.name);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      completed.add(entry.name);
      active--;
    });
    assertEquals(peak, 4);
    assertEquals(started.at(-1), "veryfront");
  });

  it("drains started publishes and does not publish root after a failed extension", async () => {
    const completed: string[] = [];
    await assertRejects(
      () =>
        publishPackages([
          { name: "bad", directory: "bad", dependencies: [] },
          { name: "good", directory: "good", dependencies: [] },
          { name: "veryfront", directory: "npm", dependencies: [] },
        ], async ({ name }) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          completed.push(name);
          if (name === "bad") throw new Error("registry refused");
        }),
      Error,
      "registry refused",
    );
    assertEquals(completed.sort(), ["bad", "good"]);
  });

  it("rejects cycles before publishing anything", async () => {
    const started: string[] = [];
    await assertRejects(
      () =>
        publishPackages([
          { name: "a", directory: "a", dependencies: ["b"] },
          { name: "b", directory: "b", dependencies: ["a"] },
          { name: "veryfront", directory: "npm", dependencies: [] },
        ], ({ name }) => {
          started.push(name);
          return Promise.resolve();
        }),
      Error,
      "Cyclic",
    );
    assertEquals(started, []);
  });

  it("rejects duplicate names or missing root", async () => {
    for (
      const entries of [
        [{ name: "a", directory: "a", dependencies: [] }],
        [{ name: "veryfront", directory: "npm", dependencies: [] }, {
          name: "veryfront",
          directory: "duplicate",
          dependencies: [],
        }],
      ]
    ) {
      await assertRejects(
        () => publishPackages(entries, () => Promise.resolve()),
        Error,
      );
    }
  });
});
