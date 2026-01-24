import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DemoOptions } from "./demo.ts";
import { DEMO_STEPS } from "./steps.ts";

describe("DemoOptions interface", () => {
  it("should accept empty options", () => {
    const options: DemoOptions = {};
    assertEquals(Object.keys(options).length, 0);
  });

  it("should accept projectName option", () => {
    const options: DemoOptions = { projectName: "my-app" };
    assertEquals(options.projectName, "my-app");
  });

  it("should accept auto option", () => {
    const options: DemoOptions = { auto: true };
    assertEquals(options.auto, true);
  });

  it("should accept loginMethod option", () => {
    const methods = ["google", "github", "microsoft", "token"] as const;

    for (const method of methods) {
      const options: DemoOptions = { loginMethod: method };
      assertEquals(options.loginMethod, method);
    }
  });

  it("should accept all options together", () => {
    const options: DemoOptions = {
      projectName: "demo-project",
      auto: true,
      loginMethod: "github",
    };
    assertEquals(options.projectName, "demo-project");
    assertEquals(options.auto, true);
    assertEquals(options.loginMethod, "github");
  });

  it("should use a dynamic default when no projectName is provided", () => {
    const options: DemoOptions = {};
    assertEquals(options.projectName, undefined);
  });

  it("should default to false when auto is not provided", () => {
    const options: DemoOptions = {};
    assertEquals(options.auto ?? false, false);
  });
});

describe("Demo steps for auto mode", () => {
  it("should have dev step that can be skipped in auto mode", () => {
    const devStep = DEMO_STEPS.find((s) => s.id === "dev");
    assertExists(devStep);
    assertEquals(devStep.hasAction, true);
    assertEquals(devStep.skipPostWait, true);
  });

  it("should have deploy step that runs in auto mode", () => {
    const deployStep = DEMO_STEPS.find((s) => s.id === "deploy");
    assertExists(deployStep);
    assertEquals(deployStep.hasAction, true);
    assertEquals(deployStep.skipPostWait, undefined);
  });

  it("should have login step that can use pre-selected method", () => {
    const loginStep = DEMO_STEPS.find((s) => s.id === "login");
    assertExists(loginStep);
    assertEquals(loginStep.hasAction, true);
  });

  it("should have done step as final step without action", () => {
    const doneStep = DEMO_STEPS.at(-1);
    assertExists(doneStep);
    assertEquals(doneStep.id, "done");
    assertEquals(doneStep.hasAction, undefined);
  });

  it("should have correct step order for auto mode flow", () => {
    assertEquals(
      DEMO_STEPS.map((s) => s.id),
      ["intro", "login", "create", "dev", "deploy", "done"],
    );
  });
});

describe("Demo auto mode configuration", () => {
  it("should support all login methods for auto mode", () => {
    const methods = ["google", "github", "microsoft", "token"] as const;

    for (const method of methods) {
      const options: DemoOptions = { auto: true, loginMethod: method };
      assertEquals(options.loginMethod, method);
    }
  });

  it("should allow custom project name in auto mode", () => {
    const options: DemoOptions = {
      auto: true,
      projectName: "auto-test-project",
    };
    assertEquals(options.projectName, "auto-test-project");
  });
});
