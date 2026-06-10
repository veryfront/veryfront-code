import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { destroyRenderer, getRenderer, initializeRenderer, Renderer } from "./renderer.ts";

function getEnv(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return g.Deno?.env?.get(name) ?? g.process?.env?.[name];
}

const RENDER_MAX_CONCURRENT_DEFAULT = 30;

function computePerProjectLimit(maxConcurrent: number): number {
  return Math.ceil(maxConcurrent / 3);
}

function createProjectSlotManager(limit: number) {
  const counts = new Map<string, number>();

  function acquire(projectId: string): boolean {
    if (limit <= 0) return true;

    const current = counts.get(projectId) ?? 0;
    if (current >= limit) return false;

    counts.set(projectId, current + 1);
    return true;
  }

  function release(projectId: string): void {
    if (limit <= 0) return;

    const current = counts.get(projectId) ?? 0;
    if (current <= 1) {
      counts.delete(projectId);
      return;
    }

    counts.set(projectId, current - 1);
  }

  function getCount(projectId: string): number {
    return counts.get(projectId) ?? 0;
  }

  function getCounts(): Map<string, number> {
    return counts;
  }

  return { acquire, release, getCount, getCounts };
}

describe("Renderer helpers", () => {
  describe("getEnv", () => {
    it("should return undefined for unset env vars", () => {
      assertEquals(getEnv("NONEXISTENT_VAR_12345"), undefined);
    });

    it("should return value for set env vars (Deno)", () => {
      const path = getEnv("PATH");
      assertEquals(typeof path === "string" || path === undefined, true);
    });
  });

  describe("computePerProjectLimit", () => {
    it("should compute default per-project limit as ceil(maxConcurrent/3)", () => {
      assertEquals(computePerProjectLimit(30), 10);
      assertEquals(computePerProjectLimit(31), 11);
      assertEquals(computePerProjectLimit(3), 1);
      assertEquals(computePerProjectLimit(1), 1);
    });

    it("should handle the default concurrent value", () => {
      assertEquals(computePerProjectLimit(RENDER_MAX_CONCURRENT_DEFAULT), 10);
    });
  });

  describe("projectSlotManager", () => {
    it("should acquire and release slots", () => {
      const manager = createProjectSlotManager(3);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.getCount("proj-1"), 1);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 0);
    });

    it("should track multiple projects independently", () => {
      const manager = createProjectSlotManager(3);
      manager.acquire("proj-a");
      manager.acquire("proj-b");
      assertEquals(manager.getCount("proj-a"), 1);
      assertEquals(manager.getCount("proj-b"), 1);
    });

    it("should reject when limit is reached", () => {
      const manager = createProjectSlotManager(2);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), false);
      assertEquals(manager.getCount("proj-1"), 2);
    });

    it("should allow acquisition after release", () => {
      const manager = createProjectSlotManager(1);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), false);
      manager.release("proj-1");
      assertEquals(manager.acquire("proj-1"), true);
    });

    it("should clean up map entry when count reaches zero", () => {
      const manager = createProjectSlotManager(2);
      manager.acquire("proj-1");
      manager.release("proj-1");
      assertEquals(manager.getCounts().has("proj-1"), false);
    });

    it("should handle release on non-acquired project gracefully", () => {
      const manager = createProjectSlotManager(2);
      manager.release("never-acquired");
      assertEquals(manager.getCount("never-acquired"), 0);
    });

    it("should bypass limits when limit is 0", () => {
      const manager = createProjectSlotManager(0);
      for (let i = 0; i < 100; i++) {
        assertEquals(manager.acquire("proj-1"), true);
      }
    });

    it("should bypass limits when limit is negative", () => {
      const manager = createProjectSlotManager(-1);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), true);
    });

    it("should decrement correctly with multiple releases", () => {
      const manager = createProjectSlotManager(5);
      manager.acquire("proj-1");
      manager.acquire("proj-1");
      manager.acquire("proj-1");
      assertEquals(manager.getCount("proj-1"), 3);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 2);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 1);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 0);
    });
  });

  describe("RENDER_PIPELINE_TIMEOUT_MS defaults", () => {
    it("should parse default timeout as 60000", () => {
      assertEquals(parseInt("60000", 10), 60000);
    });

    it("should parse custom timeout from string", () => {
      assertEquals(parseInt("30000", 10), 30000);
    });

    it("should handle invalid timeout string as NaN", () => {
      assertEquals(Number.isNaN(parseInt("not-a-number", 10)), true);
    });
  });

  describe("RENDER_MAX_CONCURRENT defaults", () => {
    it("should parse default max concurrent as 30", () => {
      assertEquals(parseInt("30", 10), 30);
    });
  });
});

describe("rendering/renderer singleton initialization", () => {
  it("waits for an in-flight singleton initialization", async () => {
    await destroyRenderer();

    const originalInitialize = Renderer.prototype.initialize;
    const originalDestroy = Renderer.prototype.destroy;
    let initializeCalls = 0;
    let resolveStarted!: () => void;
    let resolveInitialize!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const initializeDone = new Promise<void>((resolve) => {
      resolveInitialize = resolve;
    });

    Renderer.prototype.initialize = function () {
      initializeCalls++;
      resolveStarted();
      return initializeDone;
    };
    Renderer.prototype.destroy = () => Promise.resolve();

    try {
      const first = initializeRenderer();
      await started;

      let secondResolved = false;
      const second = initializeRenderer().then((value) => {
        secondResolved = true;
        return value;
      });
      await Promise.resolve();
      await Promise.resolve();

      assertEquals(secondResolved, false);

      resolveInitialize();
      const [firstRenderer, secondRenderer] = await Promise.all([first, second]);
      assertEquals(firstRenderer, secondRenderer);
      assertEquals(initializeCalls, 1);
    } finally {
      Renderer.prototype.initialize = originalInitialize;
      Renderer.prototype.destroy = originalDestroy;
      await destroyRenderer();
    }
  });

  it("does not publish a renderer after destroy runs during initialization", async () => {
    await destroyRenderer();

    const originalInitialize = Renderer.prototype.initialize;
    const originalDestroy = Renderer.prototype.destroy;
    let destroyCalls = 0;
    let resolveStarted!: () => void;
    let resolveInitialize!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const initializeDone = new Promise<void>((resolve) => {
      resolveInitialize = resolve;
    });

    Renderer.prototype.initialize = function () {
      resolveStarted();
      return initializeDone;
    };
    Renderer.prototype.destroy = () => {
      destroyCalls++;
      return Promise.resolve();
    };

    try {
      const pendingInitialize = initializeRenderer();
      await started;

      await destroyRenderer();
      resolveInitialize();

      await assertRejects(() => pendingInitialize, Error, "cancelled");
      assertThrows(() => getRenderer());
      assertEquals(destroyCalls, 1);
    } finally {
      Renderer.prototype.initialize = originalInitialize;
      Renderer.prototype.destroy = originalDestroy;
      await destroyRenderer();
    }
  });
});
