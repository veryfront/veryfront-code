import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { __setCompiledBinaryForTests } from "./isolation-capability.ts";
import {
  __resetPoolForTests,
  getIsolationPosture,
  isWorkerIsolationEnabled,
} from "./worker-pool.ts";

const ISOLATION_ENV = [
  "WORKER_ISOLATION_ENABLED",
  "WORKER_ISOLATION_API",
  "WORKER_ISOLATION_DATA",
  "WORKER_ISOLATION_SSR",
] as const;

function captureLogs(): LogEntry[] {
  const entries: LogEntry[] = [];
  Deno.env.set("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();
  __registerLogRecordEmitter((entry) => entries.push(entry));
  return entries;
}

describe("security/sandbox isolation posture reporting", () => {
  afterEach(async () => {
    for (const name of ISOLATION_ENV) {
      try {
        Deno.env.delete(name);
      } catch { /* ok */ }
    }
    try {
      Deno.env.delete("LOG_LEVEL");
    } catch { /* ok */ }
    __setCompiledBinaryForTests(undefined);
    await __resetPoolForTests();
    __resetLoggerConfigForTests();
    __resetLogRecordEmitterForTests();
  });

  it("warns when the master switch is on but no surface is actually isolated", async () => {
    await __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    const entries = captureLogs();

    assertEquals(isWorkerIsolationEnabled(), false);

    const warning = entries.find((entry) =>
      entry.level === "warn" &&
      entry.message.includes("WORKER_ISOLATION_ENABLED")
    );
    assertExists(
      warning,
      "expected a warning that the master switch enables nothing on its own",
    );
    assertEquals(warning?.context?.effectiveSurfaces, 0);
  });

  it("reports requested and effective state for every surface", async () => {
    await __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_DATA", "1");

    const posture = getIsolationPosture();

    assertEquals(posture.master, true);
    assertEquals(posture.api.requested, false);
    assertEquals(posture.api.effective, false);
    assertEquals(posture.data.requested, true);
    assertEquals(posture.data.effective, true);
    assertEquals(posture.ssr.requested, false);
    assertEquals(posture.ssr.effective, false);
    assertEquals(posture.inForce, true);
  });

  it("reports API isolation as requested but not in force when preparation is unsupported", async () => {
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_API", "1");
    __setCompiledBinaryForTests(true);
    await __resetPoolForTests();

    const posture = getIsolationPosture();

    assertEquals(posture.api.requested, true);
    assertEquals(posture.apiPreparationSupported, false);
  });

  it("does not warn when a requested surface is genuinely in force", async () => {
    await __resetPoolForTests();
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_SSR", "1");
    const entries = captureLogs();

    getIsolationPosture();

    const warning = entries.find((entry) =>
      entry.level === "warn" &&
      entry.message.includes("WORKER_ISOLATION_ENABLED")
    );
    assertEquals(warning, undefined);
  });
});
