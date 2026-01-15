import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { DEMO_STEPS, type DemoStep } from "./steps.ts";

describe("DEMO_STEPS", () => {
  it("should have at least 3 steps", () => {
    assertEquals(DEMO_STEPS.length >= 3, true);
  });

  it("should start with intro step", () => {
    const firstStep = DEMO_STEPS[0];
    assertExists(firstStep);
    assertEquals(firstStep.id, "intro");
  });

  it("should end with done step", () => {
    const lastStep = DEMO_STEPS[DEMO_STEPS.length - 1];
    assertExists(lastStep);
    assertEquals(lastStep.id, "done");
  });

  it("should have required properties on all steps", () => {
    for (const step of DEMO_STEPS) {
      assertExists(step.id, "Step should have id");
      assertExists(step.title, "Step should have title");
      assertExists(step.description, "Step should have description");
      assertEquals(Array.isArray(step.description), true, "Description should be array");
      assertEquals(step.description.length > 0, true, "Description should not be empty");
    }
  });

  it("should have command on steps with hasAction", () => {
    for (const step of DEMO_STEPS) {
      if (step.hasAction && step.id !== "login") {
        // Login step may or may not show a command since it's interactive
        assertExists(step.command, `Step ${step.id} with hasAction should have command`);
      }
    }
  });

  it("should have login step with hasAction", () => {
    const loginStep = DEMO_STEPS.find((s) => s.id === "login");
    assertExists(loginStep);
    assertEquals(loginStep.hasAction, true);
  });

  it("should have create step with hasAction", () => {
    const createStep = DEMO_STEPS.find((s) => s.id === "create");
    assertExists(createStep);
    assertEquals(createStep.hasAction, true);
    assertExists(createStep.command);
  });

  it("should have deploy step with hasAction", () => {
    const deployStep = DEMO_STEPS.find((s) => s.id === "deploy");
    assertExists(deployStep);
    assertEquals(deployStep.hasAction, true);
    assertExists(deployStep.command);
  });

  it("should have unique step ids", () => {
    const ids = DEMO_STEPS.map((s) => s.id);
    const uniqueIds = new Set(ids);
    assertEquals(ids.length, uniqueIds.size, "All step ids should be unique");
  });
});
