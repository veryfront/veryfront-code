import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/testing/deno-compat.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { HOST_PROJECT_EXECUTION_OVERRIDE_ENV } from "#veryfront/security/host-execution-policy.ts";
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
  HOST_PROJECT_EXECUTION_OVERRIDE_ENV,
] as const;

function captureLogs(): LogEntry[] {
  const entries: LogEntry[] = [];
  setEnv("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();
  __registerLogRecordEmitter((entry) => entries.push(entry));
  return entries;
}

describe("security/sandbox isolation posture reporting", () => {
  afterEach(async () => {
    for (const name of ISOLATION_ENV) {
      try {
        deleteEnv(name);
      } catch { /* ok */ }
    }
    try {
      deleteEnv("LOG_LEVEL");
    } catch { /* ok */ }
    __setCompiledBinaryForTests(undefined);
    await __resetPoolForTests();
    __resetLoggerConfigForTests();
    __resetLogRecordEmitterForTests();
  });

  it("warns when the master switch is on but no surface is actually isolated", async () => {
    await __resetPoolForTests();
    setEnv("WORKER_ISOLATION_ENABLED", "1");
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

  it("warns when a surface flag is set without the master switch", async () => {
    await __resetPoolForTests();
    setEnv("WORKER_ISOLATION_SSR", "1");
    const entries = captureLogs();

    assertEquals(
      isWorkerIsolationEnabled(),
      false,
      "a surface flag alone must not enable isolation",
    );

    const warning = entries.find((entry) =>
      entry.level === "warn" &&
      entry.message.includes("WORKER_ISOLATION_ENABLED is not")
    );
    assertExists(
      warning,
      "expected a warning that surface flags are inert without the master switch",
    );
    assertEquals(
      warning?.context?.effectiveSurfaces,
      0,
      "the warning must report that no surface resolved on",
    );
    assertEquals(
      warning?.context?.workerIsolationSsr,
      true,
      "the warning must name the flag the operator actually set",
    );
  });

  it("reports requested and effective state for every surface", async () => {
    await __resetPoolForTests();
    setEnv("WORKER_ISOLATION_ENABLED", "1");
    setEnv("WORKER_ISOLATION_DATA", "1");

    const posture = getIsolationPosture();

    assertEquals(posture.master, true);
    assertEquals(posture.api.requested, false);
    assertEquals(posture.api.effective, false);
    assertEquals(posture.data.requested, true);
    assertEquals(posture.data.effective, true);
    assertEquals(posture.ssr.requested, false);
    assertEquals(posture.ssr.effective, false);
    assertEquals(posture.hostExecutionGranted, false);
    assertEquals(posture.inForce, true);
  });

  it("keeps API isolation in force when preparation is unsupported and no grant exists", async () => {
    setEnv("WORKER_ISOLATION_ENABLED", "1");
    setEnv("WORKER_ISOLATION_API", "1");
    __setCompiledBinaryForTests(true);
    await __resetPoolForTests();

    const posture = getIsolationPosture();

    // Without an operator grant the flag stands and API ownership fails closed
    // with a typed 503, so the surface stays effective rather than downgrading.
    assertEquals(posture.api.requested, true);
    assertEquals(posture.api.effective, true);
    assertEquals(posture.apiPreparationSupported, false);
    assertEquals(posture.hostExecutionGranted, false);
    assertEquals(posture.inForce, true);
  });

  it("keeps API isolation in force when preparation is unsupported under a grant", async () => {
    setEnv("WORKER_ISOLATION_ENABLED", "1");
    setEnv("WORKER_ISOLATION_API", "1");
    setEnv(HOST_PROJECT_EXECUTION_OVERRIDE_ENV, "1");
    __setCompiledBinaryForTests(true);
    await __resetPoolForTests();

    const posture = getIsolationPosture();

    assertEquals(posture.api.requested, true);
    assertEquals(posture.api.effective, true);
    assertEquals(posture.apiPreparationSupported, false);
    assertEquals(posture.hostExecutionGranted, true);
    assertEquals(posture.inForce, true);
  });

  it("keeps the default posture off the default-verbosity dev log", async () => {
    // A developer who configured no isolation at all has nothing to act on, so
    // resolution must not spend the one line a successful dev request prints.
    await __resetPoolForTests();
    const entries = captureLogs();

    getIsolationPosture();

    const posture = entries.find((entry) =>
      entry.message.includes("Worker isolation posture resolved")
    );
    assertExists(posture, "expected the posture to still be reported at DEBUG");
    assertEquals(
      posture?.level,
      "debug",
      "unconfigured posture must not log at info",
    );
  });

  it("still reports the posture at info once isolation is actually in force", async () => {
    await __resetPoolForTests();
    setEnv("WORKER_ISOLATION_ENABLED", "1");
    setEnv("WORKER_ISOLATION_SSR", "1");
    const entries = captureLogs();

    getIsolationPosture();

    const posture = entries.find((entry) =>
      entry.message.includes("Worker isolation posture resolved")
    );
    assertExists(posture, "expected the posture to be reported");
    assertEquals(
      posture?.level,
      "info",
      "an in-force posture is operator-relevant and stays at info",
    );
  });

  it("does not warn when a requested surface is genuinely in force", async () => {
    await __resetPoolForTests();
    setEnv("WORKER_ISOLATION_ENABLED", "1");
    setEnv("WORKER_ISOLATION_SSR", "1");
    const entries = captureLogs();

    getIsolationPosture();

    const warning = entries.find((entry) =>
      entry.level === "warn" &&
      entry.message.includes("WORKER_ISOLATION_ENABLED")
    );
    assertEquals(warning, undefined);
  });
});
