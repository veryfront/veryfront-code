import "#veryfront/schemas/_test-setup.ts";
/**
 * Bootstrap unit tests — narrow coverage of the orchestrate/dispose seam.
 *
 * The full `bootstrap()` function requires substantial plumbing (config
 * loading, env, FS adapter wiring) and is covered by the integration test
 * plan (see PR 5). These tests target the extracted `orchestrateOrDisposeFS`
 * helper directly so we can verify the fsDispose guarantee on orchestration
 * failure without fabricating the whole bootstrap environment.
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { _resetShimForTests } from "#veryfront/observability/tracing/api-shim.ts";
import { register, reset } from "#veryfront/extensions/contracts.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  logger,
} from "#veryfront/utils/logger/index.ts";
import type { TracingExporter } from "veryfront/extensions/observability";
import {
  createBootstrapDisposer,
  getFileLogAttachmentLogContext,
  hasVirtualConfigFile,
  orchestrateOrDisposeFS,
  wireTracingShim,
} from "./bootstrap.ts";
import { ExtensionLoader } from "veryfront/extensions";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("orchestrateOrDisposeFS()", () => {
  it("returns the loader when orchestration succeeds", async () => {
    const loader = new ExtensionLoader(noopLogger);
    let fsDisposed = false;

    const result = await orchestrateOrDisposeFS(
      () => Promise.resolve(loader),
      () => {
        fsDisposed = true;
      },
    );

    assertEquals(result, loader);
    assertEquals(fsDisposed, false);
  });

  it("calls fsDispose and rethrows when orchestration fails", async () => {
    let fsDisposed = false;
    const boom = new Error("orchestrate-boom");

    await assertRejects(
      () =>
        orchestrateOrDisposeFS(
          () => Promise.reject(boom),
          () => {
            fsDisposed = true;
          },
        ),
      Error,
      "orchestrate-boom",
    );

    assertEquals(fsDisposed, true);
  });

  it("does not throw when fsDispose is undefined on failure", async () => {
    await assertRejects(
      () =>
        orchestrateOrDisposeFS(
          () => Promise.reject(new Error("no-dispose")),
          undefined,
        ),
      Error,
      "no-dispose",
    );
  });

  it("preserves the original error when fsDispose itself throws", async () => {
    const originalError = new Error("orchestrate-boom");

    await assertRejects(
      () =>
        orchestrateOrDisposeFS(
          () => Promise.reject(originalError),
          () => {
            throw new Error("fsDispose-boom");
          },
        ),
      Error,
      "orchestrate-boom",
    );
  });

  it("does not expose cleanup error messages through bootstrap logs", async () => {
    const entries: unknown[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));

    try {
      await assertRejects(
        () =>
          orchestrateOrDisposeFS(
            () => Promise.reject(new Error("setup failed")),
            () => {
              throw new Error("private-cleanup-canary /private/host/path");
            },
          ),
        Error,
        "setup failed",
      );
    } finally {
      __resetLogRecordEmitterForTests();
    }

    const serialized = JSON.stringify(entries);
    assertEquals(serialized.includes("private-cleanup-canary"), false);
    assertEquals(serialized.includes("/private/host/path"), false);
    assertEquals(serialized.includes("errorName"), true);
  });
});

describe("createBootstrapDisposer()", () => {
  it("runs cleanup once when disposal is concurrent or repeated", async () => {
    const events: string[] = [];
    const dispose = createBootstrapDisposer({
      teardownExtensions: async () => {
        events.push("extensions");
        await Promise.resolve();
      },
      teardownFileLog: () => {
        events.push("file-log");
      },
      clearTracing: () => {
        events.push("tracing");
      },
      disposeFileSystem: () => {
        events.push("filesystem");
      },
    });

    await Promise.all([dispose(), dispose()]);
    await dispose();

    assertEquals(events, ["extensions", "file-log", "tracing", "filesystem"]);
  });

  it("attempts every cleanup step and reports all failures", async () => {
    const events: string[] = [];
    const dispose = createBootstrapDisposer({
      teardownExtensions: () => {
        events.push("extensions");
        throw new Error("extensions failed");
      },
      teardownFileLog: () => {
        events.push("file-log");
      },
      clearTracing: () => {
        events.push("tracing");
        throw new Error("tracing failed");
      },
      disposeFileSystem: () => {
        events.push("filesystem");
      },
    });

    const error = await assertRejects(() => dispose(), AggregateError);
    assertEquals(error.errors.length, 2);
    assertEquals(events, ["extensions", "file-log", "tracing", "filesystem"]);
  });
});

describe("getFileLogAttachmentLogContext()", () => {
  it("reports file log configuration without exposing its destination", () => {
    const context = getFileLogAttachmentLogContext(
      {
        path: "/private/customer/logs/PRIVATE_FILE_LOG_PATH.log",
        level: "debug",
        format: "json",
      },
      true,
    );

    assertEquals(context, {
      customPath: true,
      level: "debug",
      format: "json",
    });
    assertEquals(JSON.stringify(context).includes("PRIVATE_FILE_LOG_PATH"), false);
  });
});

describe("hasVirtualConfigFile()", () => {
  it("detects config presence without inferring from config values", async () => {
    const inspected: string[] = [];
    const exists = await hasVirtualConfigFile({
      exists: (path) => {
        inspected.push(path);
        return Promise.resolve(path === "/veryfront.config.ts");
      },
    });

    assertEquals(exists, true);
    assertEquals(inspected, ["/veryfront.config.js", "/veryfront.config.ts"]);
  });

  it("returns false only when every recognized config file is absent", async () => {
    const exists = await hasVirtualConfigFile({
      exists: () => Promise.resolve(false),
    });

    assertEquals(exists, false);
  });
});

describe("wireTracingShim()", () => {
  it("registers and clears the TracingExporter log emitter", () => {
    reset();
    _resetShimForTests();
    __resetLogRecordEmitterForTests();

    const emitted: unknown[] = [];
    const exporter: TracingExporter = {
      start: () => Promise.resolve(),
      export: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
      getProvider: () => ({ getTracer: () => ({}) }),
      getMetricsAPI: () => null,
      getLogRecordEmitter: () => (record) => emitted.push(record),
    };

    register("TracingExporter", exporter);
    wireTracingShim();
    logger.info("otel bridge smoke", { project_id: "project-1" });

    assertEquals(emitted.length, 1);
    assertEquals((emitted[0] as { message: string }).message, "otel bridge smoke");

    reset();
    wireTracingShim();
    logger.info("after bridge clear");

    assertEquals(emitted.length, 1);
    _resetShimForTests();
    __resetLogRecordEmitterForTests();
  });
});
