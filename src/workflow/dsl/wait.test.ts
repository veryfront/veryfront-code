/**
 * Wait DSL Tests
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay, waitForApproval, waitForEvent } from "./wait.ts";
import type { WaitNodeConfig } from "../types.ts";

describe("waitForApproval()", () => {
  it("should create an approval wait node", () => {
    const node = waitForApproval("human-review", {
      message: "Please review this content",
      timeout: "24h",
    });

    assertEquals(node.id, "human-review");
    assertEquals(node.config.type, "wait");

    const config: WaitNodeConfig = node.config;
    assertEquals(config.waitType, "approval");
    assertEquals(config.message, "Please review this content");
    assertEquals(config.timeout, "24h");
  });

  it("should work with minimal options", () => {
    const node = waitForApproval("quick-review");

    assertEquals(node.id, "quick-review");
    assertEquals(node.config.type, "wait");

    const config: WaitNodeConfig = node.config;
    assertEquals(config.waitType, "approval");
  });

  it("should support approvers list", () => {
    const node = waitForApproval("restricted-review", {
      approvers: ["admin@example.com", "lead@example.com"],
    });

    const config: WaitNodeConfig = node.config;
    assertEquals(config.approvers, ["admin@example.com", "lead@example.com"]);
  });
});

describe("waitForEvent()", () => {
  it("should create an event wait node", () => {
    const node = waitForEvent("payment-confirmed", {
      eventName: "payment.success",
      timeout: "1h",
    });

    assertEquals(node.id, "payment-confirmed");
    assertEquals(node.config.type, "wait");

    const config: WaitNodeConfig = node.config;
    assertEquals(config.waitType, "event");
    assertEquals(config.eventName, "payment.success");
    assertEquals(config.timeout, "1h");
  });

  it("should require eventName", () => {
    const node = waitForEvent("specific-event", {
      eventName: "order.updated",
    });

    const config: WaitNodeConfig = node.config;
    assertEquals(config.eventName, "order.updated");
  });
});

describe("delay()", () => {
  it("should create a delay wait node", () => {
    const node = delay("cool-down", "5m");

    assertEquals(node.id, "cool-down");
    assertEquals(node.config.type, "wait");

    const config: WaitNodeConfig = node.config;
    assertEquals(config.waitType, "event");
    assertEquals(config.timeout, "5m");
  });

  it("should support numeric duration", () => {
    const node = delay("short-wait", 3000);

    const config: WaitNodeConfig = node.config;
    assertEquals(config.timeout, 3000);
  });
});
