import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as discoveryModule from "./discovery.ts";
import * as triggerModule from "./index.ts";
import * as localRunnerModule from "./local-runner.ts";
import * as publicTriggerModule from "veryfront/trigger";
import * as targetModule from "./target.ts";
import * as validationModule from "./validation.ts";

const expectedRuntimeExports = [
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
    assertStrictEquals(triggerModule.isTriggerId, validationModule.isTriggerId);
    assertStrictEquals(
      publicTriggerModule.discoverSourceTriggers,
      triggerModule.discoverSourceTriggers,
    );
    assertStrictEquals(publicTriggerModule.runTriggerTarget, triggerModule.runTriggerTarget);
    assertStrictEquals(publicTriggerModule.isTriggerTarget, triggerModule.isTriggerTarget);
    assertStrictEquals(publicTriggerModule.isTriggerId, triggerModule.isTriggerId);
  });
});
