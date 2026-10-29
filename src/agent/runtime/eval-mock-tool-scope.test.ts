import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { tool } from "#veryfront/tool/index.ts";
import { isActiveEvalMockTool, runWithEvalMockToolScope } from "./eval-mock-tool-scope.ts";

const name = "veryfront__get_file";
const fixture = () =>
  tool({ id: name, description: "Fixture", inputSchema: { type: "object" }, execute: () => ({}) });

it("isolates concurrent eval tool identities and names", async () => {
  const first = fixture(), second = fixture();
  await Promise.all(
    [first, second].map((own) =>
      runWithEvalMockToolScope({ [name]: own }, async () => {
        await Promise.resolve();
        assertEquals(isActiveEvalMockTool(name, own), true);
        assertEquals(isActiveEvalMockTool("veryfront__bash", own), false);
        assertEquals(isActiveEvalMockTool(name, own === first ? second : first), false);
      })
    ),
  );
  assertEquals(isActiveEvalMockTool(name, first), false);
});

it("revokes eval mock scope for detached work after completion or error", async () => {
  const mock = fixture();
  for (const fails of [false, true]) {
    const release = Promise.withResolvers<void>();
    let detached: Promise<boolean> | undefined;
    const run = () =>
      runWithEvalMockToolScope({ [name]: mock }, async () => {
        detached = release.promise.then(() => isActiveEvalMockTool(name, mock));
        if (fails) throw new Error("fixture failed");
      });
    if (fails) await assertRejects(run, Error, "fixture failed");
    else await run();
    release.resolve();
    assertEquals(await detached, false);
  }
});
