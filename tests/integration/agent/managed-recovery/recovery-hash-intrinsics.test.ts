import "#veryfront/schemas/_test-setup.ts";
import { createHash, Hash } from "node:crypto";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { DurableRunHome } from "#veryfront/internal-agents/durable-run-home.ts";
import { recoveryHistoryMessageDigest } from "#veryfront/internal-agents/recovery-history.ts";
import { recoverySuffixPayloadHash } from "#veryfront/internal-agents/recovery-suffix.ts";
import { createRecoverySourceManifest } from "#veryfront/internal-agents/recovery-source-manifest.ts";

it("recovery authority hashes survive project replacement of Hash prototype methods", async () => {
  const identity = {
    projectId: "11111111-1111-4111-8111-111111111111",
    canonicalRunId: "22222222-2222-4222-8222-222222222222",
    publicRunId: "run-hash-intrinsics",
    agentId: "proof-agent",
    threadId: "77777777-7777-4777-8777-777777777777",
    sourceHash: "a".repeat(64),
  };
  const message = { id: "message", role: "user", parts: [{ type: "text", text: "hello" }] };
  const files = [{ path: "a.ts", entityType: "function", content: "hello" }];
  const manifest = createRecoverySourceManifest(files);
  const history = recoveryHistoryMessageDigest(message);
  const suffix = recoverySuffixPayloadHash({ admitted: true });
  const directory = await makeTempDir();
  const update = Hash.prototype.update;
  const digest = Hash.prototype.digest;
  try {
    const home = await DurableRunHome.open({ directory, identity });
    await home.append({ sequence: 1, value: { committed: true } });
    Hash.prototype.update = function () {
      throw new Error("project replaced hash update");
    };
    Hash.prototype.digest = function () {
      throw new Error("project replaced hash digest");
    };
    assertEquals(createRecoverySourceManifest(files), manifest);
    assertEquals(recoveryHistoryMessageDigest(message), history);
    assertEquals(recoverySuffixPayloadHash({ admitted: true }), suffix);
    const reopened = await DurableRunHome.open({ directory, identity });
    await reopened.assertExecutionBinding(suffix, false);
    await reopened.append({ sequence: 2, value: { committed: "next" } });
    assertEquals((await reopened.read()).length, 2);
    const path = `${directory}/0000000001.json`;
    const original = await Deno.readTextFile(path);
    await Deno.writeTextFile(path, original.replace("committed", "corrupted"));
    await assertRejects(() => reopened.read());
  } finally {
    Hash.prototype.update = update;
    Hash.prototype.digest = digest;
    await Deno.remove(directory, { recursive: true });
  }
  assertEquals(
    createHash("sha256").update("hello").digest("hex"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});
