import { it } from "#veryfront/testing/bdd.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { DurableRunHome } from "#veryfront/internal-agents/durable-run-home.ts";
import { RecoveryEventJournal } from "#veryfront/internal-agents/recovery-event-journal.ts";
it("journal reopens and replays only the acknowledged cursor suffix", async () => {
  const directory = await Deno.makeTempDir();
  const identity = {
    projectId: "11111111-1111-4111-8111-111111111111",
    canonicalRunId: "22222222-2222-4222-8222-222222222222",
    publicRunId: "run-proof",
    sourceHash: "a".repeat(64),
  };
  try {
    const journal = new RecoveryEventJournal(await DurableRunHome.open({ directory, identity }));
    await journal.append({ sequence: 1, event: { type: "TOOL_CALL_END" } });
    await journal.append({ sequence: 2, event: { type: "RUN_FINISHED" } });
    const reopened = new RecoveryEventJournal(await DurableRunHome.open({ directory, identity }));
    assertEquals(await reopened.suffix(1), [{ sequence: 2, value: { type: "RUN_FINISHED" } }]);
    assertEquals(await reopened.suffix(2), []);
    await assertRejects(() => reopened.suffix(3));
    await assertRejects(() => reopened.suffix(-1));
    await assertRejects(() => reopened.append({ sequence: 3, event: { missingType: true } }));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
