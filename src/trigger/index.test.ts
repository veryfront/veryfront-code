import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as discoveryModule from "./discovery.ts";
import * as triggerModule from "./index.ts";
import * as localRunnerModule from "./local-runner.ts";
import * as publicTriggerModule from "veryfront/trigger";
import * as targetModule from "./target.ts";
import * as validationModule from "./validation.ts";

// The two diagnostics are public because the CLI enforces the same
// two-declaration agreement on a `--input` file that never passes through
// `schedule()`, and `cli/` may reach framework code only through package
// surfaces.
const expectedRuntimeExports = [
  "conversationConflictDiagnostic",
  "declarationConflictDiagnostic",
  "discoverSourceTriggers",
  "isTriggerId",
  "isTriggerTarget",
  "runTriggerTarget",
];

describe("trigger/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/trigger", () => {
    assertEquals(Object.keys(triggerModule).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(publicTriggerModule).sort(), expectedRuntimeExports);
  });

  it("keeps public exports wired to their owning modules", () => {
    assertStrictEquals(
      triggerModule.discoverSourceTriggers,
      discoveryModule.discoverSourceTriggers,
    );
    assertStrictEquals(triggerModule.runTriggerTarget, localRunnerModule.runTriggerTarget);
    assertStrictEquals(triggerModule.isTriggerTarget, targetModule.isTriggerTarget);
    assertStrictEquals(
      triggerModule.conversationConflictDiagnostic,
      targetModule.conversationConflictDiagnostic,
    );
    assertStrictEquals(
      triggerModule.declarationConflictDiagnostic,
      targetModule.declarationConflictDiagnostic,
    );
    assertStrictEquals(triggerModule.isTriggerId, validationModule.isTriggerId);
    assertStrictEquals(
      publicTriggerModule.discoverSourceTriggers,
      triggerModule.discoverSourceTriggers,
    );
    assertStrictEquals(publicTriggerModule.runTriggerTarget, triggerModule.runTriggerTarget);
    assertStrictEquals(publicTriggerModule.isTriggerTarget, triggerModule.isTriggerTarget);
    assertStrictEquals(
      publicTriggerModule.conversationConflictDiagnostic,
      triggerModule.conversationConflictDiagnostic,
    );
    assertStrictEquals(
      publicTriggerModule.declarationConflictDiagnostic,
      triggerModule.declarationConflictDiagnostic,
    );
    assertStrictEquals(publicTriggerModule.isTriggerId, triggerModule.isTriggerId);
  });
});
