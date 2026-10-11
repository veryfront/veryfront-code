import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { publishPackages, relayPackageOutput } from "./publish-rc-packages.ts";

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

describe("package diagnostic attribution", () => {
  it("preserves streamed lines, annotations, and non-diagnostic Actions commands", async () => {
    const chunks = [
      "first\nsec",
      "ond\r\n::error file=x::failure\n::add-mask::secret\nlast",
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });
    const lines: string[] = [];
    await relayPackageOutput(
      stream,
      "@veryfront/ext-a",
      (line) => lines.push(line),
    );
    assertEquals(lines, [
      "[@veryfront/ext-a] first",
      "[@veryfront/ext-a] second",
      "::error file=x::[@veryfront/ext-a] failure",
      "::add-mask::secret",
      "[@veryfront/ext-a] last",
    ]);
  });
});
