import "#veryfront/schemas/_test-setup.ts";
/**
 * Wait DSL Tests
 */

import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay, waitForApproval, waitForEvent, type WaitForEventOptions } from "./wait.ts";
import type { WaitNodeConfig, WorkflowNode } from "../types.ts";
import { getConfiguredTimedWaitKind, INTERNAL_DELAY_EVENT_NAME } from "../timed-wait-state.ts";

function expectWaitConfig(node: WorkflowNode): WaitNodeConfig {
  if (node.config.type !== "wait") {
    throw new Error(`Expected wait node, got ${node.config.type}`);
  }
  return node.config;
}

describe("waitForApproval()", () => {
  it("should create an approval wait node", () => {
    const node = waitForApproval("human-review", {
      message: "Please review this content",
      timeout: "24h",
    });

    const config = expectWaitConfig(node);
    assertEquals(node.id, "human-review");
    assertEquals(config.type, "wait");
    assertEquals(config.waitType, "approval");
    assertEquals(config.message, "Please review this content");
    assertEquals(config.timeout, "24h");
  });

  it("should work with minimal options", () => {
    const node = waitForApproval("quick-review");

    const config = expectWaitConfig(node);
    assertEquals(node.id, "quick-review");
    assertEquals(config.type, "wait");
    assertEquals(config.waitType, "approval");
  });

  it("should support approvers list", () => {
    const node = waitForApproval("restricted-review", {
      approvers: ["admin@example.com", "lead@example.com"],
    });

    const config = expectWaitConfig(node);
    assertEquals(config.approvers, ["admin@example.com", "lead@example.com"]);
  });
});

describe("waitForEvent()", () => {
  it("should create an event wait node", () => {
    const node = waitForEvent("payment-confirmed", {
      eventName: "payment.success",
      timeout: "1h",
    });

    const config = expectWaitConfig(node);
    assertEquals(node.id, "payment-confirmed");
    assertEquals(config.type, "wait");
    assertEquals(config.waitType, "event");
    assertEquals(config.eventName, "payment.success");
    assertEquals(config.timeout, "1h");
  });

  it("should require eventName", () => {
    const node = waitForEvent("specific-event", {
      eventName: "order.updated",
    });

    const config = expectWaitConfig(node);
    assertEquals(config.eventName, "order.updated");

    assertThrows(
      () => waitForEvent("no-event", { eventName: "" }),
      Error,
      "must specify an eventName",
      "waitForEvent must reject an empty eventName",
    );
    assertThrows(
      () => waitForEvent("no-event", {} as WaitForEventOptions),
      Error,
      "must specify an eventName",
      "waitForEvent must reject a missing eventName",
    );
  });

  it("requires a canonical non-empty eventName", () => {
    for (const eventName of ["", "   ", " order.updated "]) {
      assertThrows(
        () => waitForEvent("specific-event", { eventName }),
        VeryfrontError,
        "eventName",
        `waitForEvent must reject non-canonical eventName ${JSON.stringify(eventName)}`,
      );
    }
  });

  it("rejects the reserved delay event name", () => {
    assertThrows(
      () => waitForEvent("not-a-delay", { eventName: INTERNAL_DELAY_EVENT_NAME }),
      VeryfrontError,
      "reserved",
      "a wait on the reserved delay name would never be released by a published " +
        "event and its timeout would complete the node instead of failing the run",
    );
  });
});

describe("delay()", () => {
  it("should create a delay wait node", () => {
    const node = delay("cool-down", "5m");

    const config = expectWaitConfig(node);
    assertEquals(node.id, "cool-down");
    assertEquals(config.type, "wait");
    assertEquals(config.waitType, "event");
    assertEquals(config.timeout, "5m");
    assertEquals(
      config.eventName,
      INTERNAL_DELAY_EVENT_NAME,
      "delay nodes must carry the reserved delay event name",
    );
    assertEquals(
      getConfiguredTimedWaitKind(config),
      "delay",
      "delay() must produce a durable delay, not an external event wait",
    );
  });

  it("should support numeric duration", () => {
    const node = delay("short-wait", 3000);

    const config = expectWaitConfig(node);
    assertEquals(config.timeout, 3000);
  });

  it("carries an explicit delay marker rather than leaning on the reserved name", () => {
    const config = expectWaitConfig(delay("cool-down", "5m"));
    assertEquals(
      (config as WaitNodeConfig & { _waitKind?: string })._waitKind,
      "delay",
      "the marker keeps a delay a delay through definition capture and persistence",
    );
  });
});
