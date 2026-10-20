import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getVerifiedSkillScriptExecutionCredential,
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
