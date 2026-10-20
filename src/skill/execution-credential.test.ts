import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getVerifiedSkillScriptExecutionCredential,
  retainVerifiedSkillScriptExecutionCredentialUntil,
  runWithVerifiedSkillScriptExecutionCredential,
} from "./execution-credential.ts";

const CREDENTIAL = {
  apiUrl: "https://api.test.com",
  authToken: "run-token",
  projectId: "project-1",
  runId: "run-1",
  agentId: "agent-1",
} as const;

describe("skill execution credential", () => {
  it("revokes authority from detached descendants when the operation settles", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => release = resolve);
    let detachedRead!: Promise<string | undefined>;

    await runWithVerifiedSkillScriptExecutionCredential({
      assertActive() {},
      read: () => CREDENTIAL,
    }, async () => {
      assertEquals(getVerifiedSkillScriptExecutionCredential()?.authToken, "run-token");
      detachedRead = released.then(() => getVerifiedSkillScriptExecutionCredential()?.authToken);
    });

    release();
    await assertRejects(
      () => detachedRead,
      TypeError,
      "Skill script execution credential is no longer active",
    );
  });
});

for (const outcome of ["completed", "failed"] as const) {
  it(`revokes retained stream authority after producer ${outcome}`, async () => {
    const completion = Promise.withResolvers<void>();
    const during = Promise.withResolvers<void>();
    const after = Promise.withResolvers<void>();
    let duringRead!: Promise<string | undefined>;
    let afterRead!: Promise<string | undefined>;
    await runWithVerifiedSkillScriptExecutionCredential({
      assertActive() {},
      read: () => CREDENTIAL,
    }, async () => {
      retainVerifiedSkillScriptExecutionCredentialUntil(completion.promise);
      duringRead = during.promise.then(() =>
        getVerifiedSkillScriptExecutionCredential()?.authToken
      );
      afterRead = after.promise.then(() => getVerifiedSkillScriptExecutionCredential()?.authToken);
    });
    during.resolve();
    assertEquals(await duringRead, "run-token");
    if (outcome === "completed") completion.resolve();
    else completion.reject(new Error("Synthetic producer failure"));
    await completion.promise.catch(() => {});
    after.resolve();
    await assertRejects(() => afterRead, TypeError, "no longer active");
  });
}

it("owner cancellation overrides a retained producer credential", async () => {
  const completion = Promise.withResolvers<void>();
  const trigger = Promise.withResolvers<void>();
  const controller = new AbortController();
  let read!: Promise<string | undefined>;
  await runWithVerifiedSkillScriptExecutionCredential({
    assertActive() {
      controller.signal.throwIfAborted();
    },
    read: () => CREDENTIAL,
  }, async () => {
    retainVerifiedSkillScriptExecutionCredentialUntil(completion.promise);
    read = trigger.promise.then(() => getVerifiedSkillScriptExecutionCredential()?.authToken);
  });
  controller.abort(new Error("Synthetic owner cancellation"));
  trigger.resolve();
  await assertRejects(() => read, Error, "Synthetic owner cancellation");
  completion.resolve();
});
