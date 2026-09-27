import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProjectTraceRegistry } from "./project-trace-registry.ts";
import type { ProjectTraceConfig } from "#veryfront/server/project-env/telemetry-config.ts";

function config(projectId: string, revision = "one"): ProjectTraceConfig {
  return {
    projectId,
    environmentId: "production",
    revision,
    endpoint: "https://collector.example/v1/traces",
    headers: {},
    serviceName: projectId,
    serviceVersion: "",
    deploymentEnvironment: "production",
  };
}

describe("project trace registry", () => {
  it("bounds shutdown even if an exporter never settles and tries every generation", async () => {
    const calls: string[] = [];
    const hanging = Promise.withResolvers<void>();
    const registry = new ProjectTraceRegistry(async (cfg) => ({
      shutdown: (discard: boolean) => {
        calls.push(`${cfg.projectId}:${discard}`);
        return cfg.projectId === "a" ? hanging.promise : Promise.resolve();
      },
    }), { drainMs: 10 });
    const first = await registry.acquire(config("a"));
    const second = await registry.acquire(config("b"));
    first?.release();
    second?.release();
    await registry.shutdown();
    assertEquals(calls.includes("a:false"), true);
    assertEquals(calls.includes("b:false"), true);
    assertEquals(calls.includes("a:true"), true);
    assertEquals(await registry.acquire(config("c")), undefined);
    hanging.resolve();
  });

  it("reclaims timed-out initialization capacity and closes its eventual result", async () => {
    const creation = Promise.withResolvers<{ shutdown(discard: boolean): Promise<void> }>();
    const closed = Promise.withResolvers<boolean>();
    const registry = new ProjectTraceRegistry(
      (cfg) =>
        cfg.projectId === "a"
          ? creation.promise
          : Promise.resolve({ shutdown: () => Promise.resolve() }),
      { initializeMs: 10, maxEntries: 1 },
    );
    assertEquals(await registry.acquire(config("a")), undefined);
    const healthy = await registry.acquire(config("b"));
    assertExists(healthy);
    healthy.release();
    creation.resolve({
      shutdown: (discard) => {
        closed.resolve(discard);
        return Promise.resolve();
      },
    });
    assertEquals(await closed.promise, true);
    await registry.shutdown();
  });

  it("does not evict a released request's provider while a custom span remains active", async () => {
    let activeSpans = true;
    let stopped = 0;
    const registry = new ProjectTraceRegistry(async () => ({
      hasActiveSpans: () => activeSpans,
      shutdown: () => {
        stopped++;
        return Promise.resolve();
      },
    }), { maxEntries: 1 });
    const lease = await registry.acquire(config("a"));
    assertExists(lease);
    lease.release();
    assertEquals(await registry.acquire(config("b")), undefined);
    assertEquals(stopped, 0);
    activeSpans = false;
    const next = await registry.acquire(config("b"));
    assertExists(next);
    next.release();
    await registry.shutdown();
  });

  it("coalesces concurrent initialization and isolates project/environment identity", async () => {
    let created = 0;
    const registry = new ProjectTraceRegistry(async () => {
      created++;
      await Promise.resolve();
      return { shutdown: () => Promise.resolve() };
    });
    try {
      const leases = await Promise.all([
        registry.acquire(config("a")),
        registry.acquire(config("a")),
        registry.acquire(config("b")),
      ]);
      assertEquals(created, 2);
      assertExists(leases[0]);
      assertEquals(leases[0]?.session === leases[1]?.session, true);
      assertEquals(leases[0]?.session === leases[2]?.session, false);
      leases.forEach((lease) => lease?.release());
    } finally {
      await registry.shutdown();
    }
  });

  it("keeps an old generation alive until its lease releases while new work uses rotated settings", async () => {
    const stopped: string[] = [];
    const registry = new ProjectTraceRegistry(async (cfg) => ({
      revision: cfg.revision,
      shutdown: () => {
        stopped.push(cfg.revision);
        return Promise.resolve();
      },
    }));
    try {
      const old = await registry.acquire(config("a", "old"));
      const next = await registry.acquire(config("a", "new"));
      assertExists(old);
      assertExists(next);
      assertEquals(old.session.revision, "old");
      assertEquals(next.session.revision, "new");
      assertEquals(stopped, []);
      old.release();
      await Promise.resolve();
      assertEquals(stopped, ["old"]);
      next.release();
    } finally {
      await registry.shutdown();
    }
  });

  it("revokes active and queued export when a project is disabled", async () => {
    const modes: boolean[] = [];
    const registry = new ProjectTraceRegistry(async () => ({
      shutdown: (discard: boolean) => {
        modes.push(discard);
        return Promise.resolve();
      },
    }));
    const lease = await registry.acquire(config("a"));
    assertExists(lease);
    await registry.disable("a", "production");
    assertEquals(modes, [true]);
    lease.release();
    await registry.shutdown();
  });

  it("does not publish a generation revoked during asynchronous initialization", async () => {
    const ready = Promise.withResolvers<{ shutdown(discard: boolean): Promise<void> }>();
    const modes: boolean[] = [];
    const registry = new ProjectTraceRegistry(() => ready.promise);
    const pending = registry.acquire(config("a"));
    const disable = registry.disable("a", "production");
    ready.resolve({
      shutdown: (discard) => {
        modes.push(discard);
        return Promise.resolve();
      },
    });
    assertEquals(await pending, undefined);
    await disable;
    assertEquals(modes, [true]);
    await registry.shutdown();
  });

  it("bounds active generations and admits another project after an idle entry is released", async () => {
    const registry = new ProjectTraceRegistry(async () => ({ shutdown: () => Promise.resolve() }), {
      maxEntries: 1,
    });
    try {
      const a = await registry.acquire(config("a"));
      assertExists(a);
      assertEquals(await registry.acquire(config("b")), undefined);
      a.release();
      const b = await registry.acquire(config("b"));
      assertExists(b);
      b.release();
    } finally {
      await registry.shutdown();
    }
  });

  it("expires idle sessions and bounds retirement of a leased old generation", async () => {
    const expired = Promise.withResolvers<void>();
    const discarded = Promise.withResolvers<void>();
    const registry = new ProjectTraceRegistry(async (cfg) => ({
      shutdown: (discard: boolean) => {
        if (cfg.revision === "old" && discard) discarded.resolve();
        else expired.resolve();
        return Promise.resolve();
      },
    }), { idleMs: 10, drainMs: 10 });
    try {
      const old = await registry.acquire(config("a", "old"));
      const next = await registry.acquire(config("a", "new"));
      next?.release();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([expired.promise, discarded.promise]),
          new Promise((_, reject) => {
            deadline = setTimeout(() => reject(new Error("retirement did not finish")), 500);
          }),
        ]);
      } finally {
        if (deadline !== undefined) clearTimeout(deadline);
      }
      old?.release();
    } finally {
      await registry.shutdown();
    }
  });

  it("fails open on factory failure and does not keep failed entries", async () => {
    let attempts = 0;
    const registry = new ProjectTraceRegistry(async () => {
      if (attempts++ === 0) throw new Error("synthetic-factory-failure");
      return { shutdown: () => Promise.resolve() };
    });
    try {
      assertEquals(await registry.acquire(config("a")), undefined);
      const lease = await registry.acquire(config("a"));
      assertExists(lease);
      lease.release();
    } finally {
      await registry.shutdown();
    }
  });
});
