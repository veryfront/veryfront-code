import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";
import { clearConfigCache } from "#veryfront/config";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
  refreshLoggerConfig,
} from "#veryfront/utils/logger/index.ts";
import { SecurityConfigLoader } from "../http/config.ts";

const testSuite = isDeno ? describe : describe.skip;

type WorkerFaultKind = "uncaught" | "rejection";

interface WorkerFaultSubprocessResult {
  readonly stderr: string;
  readonly summary: {
    readonly hasPendingRequests: boolean;
    readonly idleNotifications: number;
    readonly rejectionCount: number;
    readonly resolved: boolean;
    readonly status: string;
  };
}

async function runWorkerFaultSubprocess(
  faultKind: WorkerFaultKind,
): Promise<WorkerFaultSubprocessResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--quiet",
      "--no-check",
      "--allow-all",
      "--unstable-worker-options",
      new URL("./telemetry-redaction.fixture.ts", import.meta.url).pathname,
      faultKind,
    ],
    cwd: Deno.cwd(),
    env: {
      LOG_FORMAT: "text",
      LOG_LEVEL: "ERROR",
    },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 0, stderr);
  const summaryLine = stdout.split("\n").at(-1);
  if (!summaryLine) throw new Error("Worker fault fixture returned no summary");
  return {
    stderr,
    summary: JSON.parse(summaryLine),
  } as WorkerFaultSubprocessResult;
}

function assertContainedWorkerFault(
  result: WorkerFaultSubprocessResult,
  expected: {
    readonly modulePath: string;
    readonly sourceMarker: string;
    readonly tenantMarker: string;
  },
): void {
  assertEquals(result.stderr.includes(expected.tenantMarker), false);
  assertEquals(result.stderr.includes(expected.modulePath), false);
  assertEquals(result.stderr.includes(expected.sourceMarker), false);
  assertEquals(
    result.stderr.includes(encodeURIComponent(expected.sourceMarker)),
    false,
  );
  assertEquals(result.summary, {
    hasPendingRequests: false,
    idleNotifications: 1,
    rejectionCount: 1,
    resolved: false,
    status: "terminated",
  });
}

testSuite("security worker telemetry redaction", () => {
  it("suppresses uncaught project diagnostics at process stderr", async () => {
    const tenantMarker = "VF_TENANT_UNCAUGHT_SECRET_7f3c";
    assertContainedWorkerFault(
      await runWorkerFaultSubprocess("uncaught"),
      {
        tenantMarker,
        modulePath: `/tenants/${tenantMarker}/private-route.ts`,
        sourceMarker: "VF_PRIVATE_SOURCE_UNCAUGHT_8e2b",
      },
    );
  });

  it("suppresses unhandled project rejection diagnostics at process stderr", async () => {
    const tenantMarker = "VF_TENANT_REJECTION_SECRET_3d6a";
    assertContainedWorkerFault(
      await runWorkerFaultSubprocess("rejection"),
      {
        tenantMarker,
        modulePath: `/tenants/${tenantMarker}/private-route.ts`,
        sourceMarker: "VF_PRIVATE_SOURCE_REJECTION_9c4e",
      },
    );
  });

  it("does not emit config-loader failure details or project paths", async () => {
    const tenantMarker = `config-${crypto.randomUUID()}`;
    const projectDir = `/tenants/${tenantMarker}`;
    const entries: LogEntry[] = [];
    const adapter = new DenoAdapter();
    adapter.fs.exists = () =>
      Promise.reject(new Error(`failed to inspect ${projectDir}: ${tenantMarker}`));
    const previousLogLevel = Deno.env.get("LOG_LEVEL");
    const originalConsoleDebug = console.debug;

    try {
      clearConfigCache();
      Deno.env.set("LOG_LEVEL", "DEBUG");
      refreshLoggerConfig();
      __registerLogRecordEmitter((entry) => entries.push(entry));
      console.debug = () => {};

      const loader = new SecurityConfigLoader(projectDir, adapter);
      await assertRejects(
        () => loader.ensureLoaded(),
        Error,
        tenantMarker,
      );

      const diagnostic = entries.find(
        (entry) => entry.message === "Failed to load security config; will retry on next request",
      );
      assertExists(diagnostic);
      const serialized = JSON.stringify(diagnostic);
      assertEquals(serialized.includes(tenantMarker), false);
      assertEquals(serialized.includes(projectDir), false);
      assertEquals(diagnostic.error, undefined);
    } finally {
      clearConfigCache();
      console.debug = originalConsoleDebug;
      __resetLogRecordEmitterForTests();
      if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", previousLogLevel);
      refreshLoggerConfig();
    }
  });
});
