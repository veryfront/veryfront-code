import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isDeno } from "#veryfront/platform/compat/runtime.ts";
import {
  createPreparedDeclarativeConfigWorkerPayload,
  DeclarativeConfigEvaluationError,
  prepareDeclarativeConfigContext,
} from "./declarative-evaluator.ts";
import { __subscribeLogRecordEmitter } from "#veryfront/utils/logger/logger.ts";
import {
  declarativeConfigWorkerRunnerInternals,
  evaluatePreparedDeclarativeConfigInWorker,
} from "./declarative-evaluator-worker-runner.ts";

describe("declarative config runtime worker", () => {
  it("rejects Bun when bounded worker memory limits are unavailable", async () => {
    if (!isBun) return;
    const context = await prepareDeclarativeConfigContext({
      environmentName: "preview",
      environment: {},
    });
    const payload = createPreparedDeclarativeConfigWorkerPayload(
      `export default { title: "unreachable" };`,
      context,
      "veryfront.config.ts",
    );

    const error = await assertRejects(() => evaluatePreparedDeclarativeConfigInWorker(payload));

    assertEquals(
      error instanceof Error && "reason" in error
        ? (error as { reason?: unknown }).reason
        : undefined,
      "worker-memory-limit-unavailable",
    );
    assertEquals(
      error instanceof Error ? error.message : undefined,
      "Hosted configuration rejected (evaluator-unavailable: worker-memory-limit-unavailable)",
    );
  });

  it("evaluates a hosted TypeScript config", async () => {
    if (isBun) return;
    const context = await prepareDeclarativeConfigContext({
      environmentName: "preview",
      environment: { TENANT: "tenant-value" },
    });
    const payload = createPreparedDeclarativeConfigWorkerPayload(
      `
        import { defineConfigWithEnv, getEnv } from "veryfront";
        export default defineConfigWithEnv((environmentName) => ({
          title: \`\${environmentName}:\${getEnv("TENANT") ?? "missing"}\`,
        }));
      `,
      context,
      "veryfront.config.ts",
    );

    const config = await evaluatePreparedDeclarativeConfigInWorker(payload);

    assertEquals(config.title, "preview:tenant-value");
  });
});

describe("Deno configuration worker error isolation", () => {
  for (const outcome of ["abort", "error", "success", "hostile-getter"] as const) {
    it(`contains a late null worker error after evaluation ${outcome}`, async () => {
      if (!isDeno) return;
      const context = await prepareDeclarativeConfigContext({
        environmentName: "preview",
        environment: {},
      });
      const payload = createPreparedDeclarativeConfigWorkerPayload(
        "export default { title: 'test' };",
        context,
        "veryfront.config.ts",
      );
      const controller = new AbortController();
      const failures: ErrorEvent[] = [];
      const logs: Array<{ message: string; context?: Record<string, unknown> }> = [];
      const unsubscribe = __subscribeLogRecordEmitter((record) => {
        if (record.message === "Hosted configuration worker failed") logs.push(record);
      });
      class HostileErrorEvent extends ErrorEvent {
        override get error(): unknown {
          throw new Error("private project getter must not run");
        }
      }
      class TestWorker extends EventTarget {
        postMessage() {
          if (outcome === "abort") controller.abort();
          else if (outcome === "error" || outcome === "hostile-getter") {
            const EventConstructor = outcome === "hostile-getter" ? HostileErrorEvent : ErrorEvent;
            const event = new EventConstructor("error", {
              error: outcome === "hostile-getter" ? null : new Error("private project error"),
              cancelable: true,
            });
            failures.push(event);
            this.dispatchEvent(event);
          } else {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: { ok: true, snapshot: { title: "test" } },
              }),
            );
          }
        }
        terminate() {
          // Deno can deliver an already queued worker failure during termination.
          const event = new ErrorEvent("error", {
            error: null,
            message: "Uncaught null",
            cancelable: true,
          });
          failures.push(event);
          this.dispatchEvent(event);
        }
      }
      try {
        const evaluate = () =>
          declarativeConfigWorkerRunnerInternals.evaluateWithEndpointFactory(
            payload,
            { signal: controller.signal },
            async () =>
              declarativeConfigWorkerRunnerInternals.createDenoWorkerEndpoint(
                TestWorker as unknown as typeof Worker,
              ),
          );
        if (outcome === "success") {
          assertEquals(await evaluate(), { title: "test" });
        } else {
          const error = await assertRejects(
            evaluate,
            DeclarativeConfigEvaluationError,
          ) as DeclarativeConfigEvaluationError;
          assertEquals(error.reason, outcome === "abort" ? "worker-aborted" : "worker-unavailable");
        }
        assertEquals(failures.length, outcome === "error" || outcome === "hostile-getter" ? 2 : 1);
        assertEquals(
          failures.every((event) => event.defaultPrevented),
          true,
          "a queued worker error must not kill the host after evaluation cleanup",
        );
        assertEquals(logs.at(-1)?.context?.error, "null");
        assertEquals(logs.at(-1)?.context?.evaluationActive, false);
        if (outcome === "error" || outcome === "hostile-getter") {
          assertEquals(
            logs[0]?.context?.error,
            outcome === "hostile-getter" ? "null" : "Worker error",
          );
          assertEquals(logs[0]?.context?.evaluationActive, true);
        }
      } finally {
        unsubscribe();
      }
    });
  }
});
