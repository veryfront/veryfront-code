import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { ProjectIsolationManager } from "./project-isolation.ts";

describe("server/runtime-handler/project-isolation", () => {
  afterEach(() => {
    __resetLogRecordEmitterForTests();
  });

  function createManager(
    overrides: Partial<{
      maxConcurrentPerProject: number;
      circuitBreakerThreshold: number;
      circuitResetTimeMs: number;
      failureWindowMs: number;
      maxTrackedProjects: number;
    }> = {},
  ): ProjectIsolationManager {
    return new ProjectIsolationManager({
      maxConcurrentPerProject: 3,
      circuitBreakerThreshold: 2,
      circuitResetTimeMs: 100,
      failureWindowMs: 5000,
      ...overrides,
    });
  }

  describe("checkRequest", () => {
    it("should allow requests when no project slug is provided", () => {
      const manager = createManager();
      const result = manager.checkRequest(undefined);
      assertEquals(result.allowed, true);
      manager.shutdown();
    });

    it("should allow requests for a new project", () => {
      const manager = createManager();
      const result = manager.checkRequest("my-project");
      assertEquals(result.allowed, true);
      manager.shutdown();
    });

    it("should reject when max concurrent is reached", () => {
      const manager = createManager({ maxConcurrentPerProject: 2 });
      manager.startRequest("proj");
      manager.startRequest("proj");

      const result = manager.checkRequest("proj");
      assertEquals(result.allowed, false);
      assertEquals(result.reason, "max_concurrent");
      manager.shutdown();
    });

    it("should allow after completing a request that freed a slot", () => {
      const manager = createManager({ maxConcurrentPerProject: 2 });
      manager.startRequest("proj");
      manager.startRequest("proj");
      manager.completeRequest("proj", false);

      const result = manager.checkRequest("proj");
      assertEquals(result.allowed, true);
      manager.shutdown();
    });

    it("should reject when circuit is open", () => {
      const manager = createManager({
        circuitBreakerThreshold: 2,
        circuitResetTimeMs: 60_000,
      });

      manager.startRequest("proj");
      manager.completeRequest("proj", true); // failure 1
      manager.startRequest("proj");
      manager.completeRequest("proj", true); // failure 2 - opens circuit

      const result = manager.checkRequest("proj");
      assertEquals(result.allowed, false);
      assertEquals(result.reason, "circuit_open");
      assertEquals(typeof result.waitTimeMs, "number");
      manager.shutdown();
    });

    it("should not affect different projects", () => {
      const manager = createManager({ maxConcurrentPerProject: 1 });
      manager.startRequest("proj-a");

      const checkA = manager.checkRequest("proj-a");
      assertEquals(checkA.allowed, false);

      const checkB = manager.checkRequest("proj-b");
      assertEquals(checkB.allowed, true);
      manager.shutdown();
    });
  });

  describe("startRequest", () => {
    it("should be a no-op for undefined slug", () => {
      const manager = createManager();
      manager.startRequest(undefined);
      assertEquals(Object.keys(manager.getStats()).length, 0);
      manager.shutdown();
    });

    it("should increment in-flight count", () => {
      const manager = createManager();
      manager.startRequest("proj");
      manager.startRequest("proj");

      const stats = manager.getStats();
      assertEquals(stats["proj"]?.inFlight, 2);
      assertEquals(stats["proj"]?.totalRequests, 2);
      manager.shutdown();
    });
  });

  describe("completeRequest", () => {
    it("should be a no-op for undefined slug", () => {
      const manager = createManager();
      manager.completeRequest(undefined, false);
      assertEquals(Object.keys(manager.getStats()).length, 0);
      manager.shutdown();
    });

    it("should be a no-op for unknown project slug", () => {
      const manager = createManager();
      manager.completeRequest("unknown", false);
      assertEquals(Object.keys(manager.getStats()).length, 0);
      manager.shutdown();
    });

    it("should decrement in-flight count", () => {
      const manager = createManager();
      manager.startRequest("proj");
      manager.startRequest("proj");
      manager.completeRequest("proj", false);
      assertEquals(manager.getStats()["proj"]?.inFlight, 1);
      manager.shutdown();
    });

    it("should not go below zero in-flight", () => {
      const manager = createManager();
      manager.startRequest("proj");
      manager.completeRequest("proj", false);
      manager.completeRequest("proj", false);
      assertEquals(manager.getStats()["proj"]?.inFlight, 0);
      manager.shutdown();
    });

    it("should record timeout failures", () => {
      const manager = createManager();
      manager.startRequest("proj");
      manager.completeRequest("proj", true);

      const stats = manager.getStats()["proj"];
      assertEquals(stats?.totalTimeouts, 1);
      assertEquals(stats?.recentFailures, 1);
      manager.shutdown();
    });

    it("should record a timeout without releasing in-flight work", () => {
      const manager = createManager();
      manager.startRequest("proj");
      manager.recordTimeout("proj");

      const stats = manager.getStats()["proj"];
      assertEquals(stats?.inFlight, 1);
      assertEquals(stats?.totalTimeouts, 1);
      assertEquals(stats?.recentFailures, 1);
      manager.shutdown();
    });

    it("should open circuit after reaching failure threshold", () => {
      const manager = createManager({ circuitBreakerThreshold: 2 });
      manager.startRequest("proj");
      manager.completeRequest("proj", true);
      assertEquals(manager.getStats()["proj"]?.circuitOpen, false);

      manager.startRequest("proj");
      manager.completeRequest("proj", true);
      assertEquals(manager.getStats()["proj"]?.circuitOpen, true);
      manager.shutdown();
    });
  });

  describe("getStats", () => {
    it("should return empty stats when no projects tracked", () => {
      const manager = createManager();
      assertEquals(manager.getStats(), {});
      manager.shutdown();
    });

    it("should return stats for tracked projects", () => {
      const manager = createManager();
      manager.startRequest("proj-a");
      manager.startRequest("proj-b");

      const stats = manager.getStats();
      assertEquals(Object.keys(stats).length, 2);
      assertEquals(stats["proj-a"]?.inFlight, 1);
      assertEquals(stats["proj-b"]?.inFlight, 1);
      manager.shutdown();
    });
  });

  describe("bounded project state", () => {
    it("rejects invalid capacity and timing configuration", () => {
      for (
        const overrides of [
          { maxTrackedProjects: 0 },
          { maxConcurrentPerProject: 0 },
          { circuitBreakerThreshold: 0 },
          { circuitResetTimeMs: -1 },
          { failureWindowMs: Number.NaN },
        ]
      ) {
        assertThrows(() => createManager(overrides), TypeError);
      }
    });

    it("evicts the least-recent inactive project at capacity", () => {
      const manager = createManager({ maxTrackedProjects: 2 });
      assertEquals(manager.checkRequest("project-a").allowed, true);
      assertEquals(manager.checkRequest("project-b").allowed, true);
      assertEquals(manager.checkRequest("project-c").allowed, true);

      const stats = manager.getStats();
      assertEquals(Object.keys(stats).length, 2);
      assertEquals(stats["project-a"], undefined);
      assertEquals(stats["project-c"] !== undefined, true);
      manager.shutdown();
    });

    it("does not evict active circuit state to admit another project", () => {
      const manager = createManager({
        maxTrackedProjects: 1,
        circuitBreakerThreshold: 1,
        circuitResetTimeMs: 60_000,
      });
      manager.startRequest("project-a");
      manager.completeRequest("project-a", true);

      const result = manager.checkRequest("project-b");
      assertEquals(result, { allowed: false, reason: "capacity" });
      assertEquals(manager.getStats()["project-a"]?.circuitOpen, true);
      manager.shutdown();
    });

    it("does not log project identifiers in isolation failures", () => {
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));
      const manager = createManager({ maxConcurrentPerProject: 1 });
      manager.startRequest("private-project-value");
      manager.checkRequest("private-project-value");

      assertEquals(JSON.stringify(entries).includes("private-project-value"), false);
      manager.shutdown();
    });
  });

  describe("shutdown", () => {
    it("should clear all tracked projects", () => {
      const manager = createManager();
      manager.startRequest("proj-a");
      manager.startRequest("proj-b");
      manager.shutdown();
      assertEquals(manager.getStats(), {});
    });
  });

  describe("circuit breaker reset", () => {
    it("should reset circuit after reset time elapses", async () => {
      const manager = createManager({
        circuitBreakerThreshold: 1,
        circuitResetTimeMs: 50,
      });

      manager.startRequest("proj");
      manager.completeRequest("proj", true); // opens circuit

      const beforeReset = manager.checkRequest("proj");
      assertEquals(beforeReset.allowed, false);
      assertEquals(beforeReset.reason, "circuit_open");

      await new Promise((resolve) => setTimeout(resolve, 80));

      const afterReset = manager.checkRequest("proj");
      assertEquals(afterReset.allowed, true);
      manager.shutdown();
    });
  });
});
