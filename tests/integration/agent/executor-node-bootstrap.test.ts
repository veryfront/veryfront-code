import "#veryfront/schemas/_test-setup.ts";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { getEventListeners } from "node:events";
import process from "node:process";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  createExecutorChannel,
  type ExecutorOperation,
} from "#veryfront/agent/executor/channel.ts";
import {
  type ExecutorBootstrapEnvironment,
  startExecutorNodeBootstrap,
} from "#veryfront/agent/hosted/executor-node-bootstrap.ts";
import { connectExecutorTransport } from "#veryfront/agent/hosted/executor-node-transport.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { registerExecutorRuntimeEntrypointTests } from "./executor-runtime-entrypoint.fixture.ts";

const binding = {
  allocationId: "00000000-0000-4000-8000-000000000001",
  generation: 1,
  invocationId: "00000000-0000-4000-8000-000000000002",
};
const values: Record<string, string> = {
  VERYFRONT_EXECUTOR_ALLOCATION_ID: binding.allocationId,
  VERYFRONT_EXECUTOR_GENERATION: "1",
  VERYFRONT_EXECUTOR_INVOCATION_ID: binding.invocationId,
  VERYFRONT_EXECUTOR_ACTIVE_DEADLINE_SECONDS: "60",
  VERYFRONT_EXECUTOR_HARD_DEADLINE_AT: String(Date.now() + 120_000),
  PORT: "8081",
};
const environment = (
  overrides: Record<string, string | undefined> = {},
): ExecutorBootstrapEnvironment => ({
  get: (name) => Object.hasOwn(overrides, name) ? overrides[name] : values[name],
});
const operations = new Map<string, ExecutorOperation>([
  ["echo", { mode: "unary", handle: (input) => input }],
  ["remaining", { mode: "unary", handle: (_input, context) => context.deadline - Date.now() }],
]);

async function connectCaller(port: number, key: Uint8Array) {
  const transport = await connectExecutorTransport({
    podIp: "127.0.0.1",
    port,
    key,
    binding,
    timeoutMs: 60_000,
  });
  return createExecutorChannel({ binding, transport, defaultTimeoutMs: 60_000 });
}

// Same-process component integration with synthetic keys. The production port
// is fixed; these tests run sequentially and never stop an unrelated listener.
if (typeof Deno !== "undefined") {
  it(
    "runs fixed executor bootstrap and TLS channel coverage on Node",
    { timeout: 30_000 },
    async () => {
      const root = new URL("../../../", import.meta.url);
      const child = spawn("node", [
        "--import",
        fileURLToPath(new URL("tests/node/resolver.mjs", root)),
        "--test",
        fileURLToPath(import.meta.url),
      ], { cwd: fileURLToPath(root), stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => output += chunk);
      child.stderr.on("data", (chunk) => output += chunk);
      const timer = setTimeout(() => child.kill(), 25_000);
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", resolve);
        });
        assertEquals(code, 0, output);
      } finally {
        clearTimeout(timer);
        child.kill();
      }
    },
  );
} else {
  describe("fixed Node executor bootstrap", () => {
    registerExecutorRuntimeEntrypointTests();
    it("accepts native Node when a Deno compatibility namespace is present", async () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, "Deno");
      const key = randomBytes(32);
      let bootstrap: Awaited<ReturnType<typeof startExecutorNodeBootstrap>> | undefined;
      let caller: Awaited<ReturnType<typeof connectCaller>> | undefined;
      Object.defineProperty(globalThis, "Deno", {
        configurable: true,
        value: { version: { deno: "compatibility" } },
      });
      try {
        bootstrap = await startExecutorNodeBootstrap({
          operations,
          environment: environment(),
          readKey: () => Promise.resolve(new Uint8Array(key)),
        });
        caller = await connectCaller(bootstrap.address.port, key);
        await caller.ready;
        assertEquals(await caller.request("echo", "packaged-node"), "packaged-node");
      } finally {
        if (original) Object.defineProperty(globalThis, "Deno", original);
        else Reflect.deleteProperty(globalThis, "Deno");
        caller?.close();
        bootstrap?.close();
        await caller?.settled;
        await bootstrap?.ready.then((channel) => channel.settled, () => {});
      }
    });
    it("rejects missing and noncanonical bootstrap values before reading a key", async () => {
      let reads = 0;
      const invalid: Record<string, string | undefined>[] = Object.keys(values).map((name) => ({
        [name]: undefined,
      }));
      invalid.push(
        { VERYFRONT_EXECUTOR_ALLOCATION_ID: "00000000-0000-4000-8000-00000000000A" },
        { VERYFRONT_EXECUTOR_INVOCATION_ID: "invalid" },
        ...["0", "01", "+1", "1.0", "1e2", " 1", "1\n", "9007199254740992"].map((value) => ({
          VERYFRONT_EXECUTOR_GENERATION: value,
        })),
        ...["0", "01", "+1", "1.0", "1e2", "86401"].map((value) => ({
          VERYFRONT_EXECUTOR_ACTIVE_DEADLINE_SECONDS: value,
        })),
        ...["0", "01", "+1", "1.0", "1e12", " 1", "1\n", "9007199254740992"].map((value) => ({
          VERYFRONT_EXECUTOR_HARD_DEADLINE_AT: value,
        })),
        { PORT: "0" },
        { PORT: "8080" },
        { PORT: "08081" },
      );
      for (const invalidValues of invalid) {
        await assertRejects(
          async () => {
            const unexpected = await startExecutorNodeBootstrap({
              operations,
              environment: environment(invalidValues),
              readKey: () => {
                reads++;
                return Promise.resolve(randomBytes(32));
              },
            });
            unexpected.close();
          },
          TypeError,
          "Invalid executor bootstrap environment",
        );
      }
      assertEquals(reads, 0);
    });

    it("requires the schema validator before key I/O", async () => {
      const validator = tryResolve("SchemaValidator");
      unregister("SchemaValidator");
      let reads = 0;
      try {
        await assertRejects(
          () =>
            startExecutorNodeBootstrap({
              operations,
              environment: environment(),
              readKey: () => {
                reads++;
                return Promise.resolve(randomBytes(32));
              },
            }),
          Error,
          "Executor bootstrap requires a registered schema validator",
        );
        assertEquals(reads, 0);
      } finally {
        register("SchemaValidator", validator);
      }
    });

    it("rejects an expired allocation before key I/O", async () => {
      let reads = 0;
      try {
        await assertRejects(
          async () => {
            const unexpected = await startExecutorNodeBootstrap({
              operations,
              environment: environment({
                VERYFRONT_EXECUTOR_HARD_DEADLINE_AT: String(Date.now() - 1),
              }),
              readKey: () => {
                reads++;
                return Promise.resolve(randomBytes(32));
              },
            });
            unexpected.close();
          },
          Error,
          "Executor bootstrap deadline exceeded",
        );
        assertEquals(reads, 0);
      } finally {
        await setImmediate();
      }
    });

    it("expires during delayed key acquisition and wipes the late key", async () => {
      const completed = Promise.withResolvers<void>();
      const bytes = randomBytes(32);
      await assertRejects(
        async () => {
          const unexpected = await startExecutorNodeBootstrap({
            operations,
            environment: environment({
              VERYFRONT_EXECUTOR_HARD_DEADLINE_AT: String(Date.now() + 30),
            }),
            readKey: async () => {
              await new Promise<void>((resolve) => setTimeout(resolve, 60));
              completed.resolve();
              return bytes;
            },
          });
          unexpected.close();
        },
        Error,
        "Executor bootstrap deadline exceeded",
      );
      await completed.promise;
      await setImmediate();
      assert(bytes.every((byte) => byte === 0));
    });

    it("rejects short or oversized keys, wipes them, and sanitizes reader errors", async () => {
      for (const length of [0, 31, 33, 64]) {
        const bytes = randomBytes(length);
        await assertRejects(
          () =>
            startExecutorNodeBootstrap({
              operations,
              environment: environment(),
              readKey: () => Promise.resolve(bytes),
            }),
          Error,
          "Executor bootstrap requires exactly 32 key bytes",
        );
        assert(bytes.every((byte) => byte === 0));
      }
      const error = await assertRejects(() =>
        startExecutorNodeBootstrap({
          operations,
          environment: environment(),
          readKey: () => Promise.reject(new Error("synthetic-private-detail")),
        }), Error);
      assert(error instanceof Error);
      assertEquals(error.message, "Executor bootstrap key read failed");
      assertEquals(error.cause, undefined);
    });

    it("reads only fixed environment names and exposes a ready authenticated echo channel", async () => {
      const key = randomBytes(32);
      const transferred = new Uint8Array(key);
      const queried: string[] = [];
      const ambient: Record<string, string> = {
        ...values,
        UNRELATED_SECRET: "synthetic-unused-value",
      };
      const bootstrap = await startExecutorNodeBootstrap({
        operations,
        environment: {
          get(name) {
            queried.push(name);
            return ambient[name];
          },
        },
        readKey: () => Promise.resolve(transferred),
      });
      let ready = false;
      void bootstrap.ready.then(() => ready = true, () => {});
      try {
        assertEquals(bootstrap.address.port, 8081);
        assertEquals(queried.sort(), Object.keys(values).sort());
        assert(transferred.every((byte) => byte === 0));
        assertEquals(Object.keys(bootstrap).sort(), ["address", "close", "ready"]);
        assertEquals(JSON.stringify(bootstrap).includes("synthetic-unused-value"), false);
        await setImmediate();
        assertEquals(ready, false);
        const transport = await connectExecutorTransport({
          podIp: "127.0.0.1",
          port: 8081,
          key,
          binding,
          timeoutMs: 60_000,
        });
        await setImmediate();
        assertEquals(ready, false);
        const caller = createExecutorChannel({ binding, transport, defaultTimeoutMs: 60_000 });
        try {
          const server = await bootstrap.ready;
          await caller.ready;
          assertEquals(server.signal.aborted, false);
          assertEquals(await caller.request("echo", { message: "synthetic" }), {
            message: "synthetic",
          });
          const remaining = await caller.request("remaining", {}, { timeoutMs: 45_000 });
          assert(typeof remaining === "number" && remaining > 30_000);
        } finally {
          caller.close();
          await caller.closed;
        }
      } finally {
        bootstrap.close();
        key.fill(0);
        await setImmediate();
      }
    });

    it("rejects an incorrect key without resolving channel readiness", async () => {
      const key = randomBytes(32);
      const bootstrap = await startExecutorNodeBootstrap({
        operations,
        environment: environment(),
        readKey: () => Promise.resolve(new Uint8Array(key)),
      });
      let ready = false;
      void bootstrap.ready.then(() => ready = true, () => {});
      try {
        await assertRejects(
          () => connectCaller(8081, randomBytes(32)),
          Error,
          "authentication failed",
        );
        assertEquals(ready, false);
        const caller = await connectCaller(8081, key);
        await bootstrap.ready;
        caller.close();
        await caller.closed;
      } finally {
        bootstrap.close();
        key.fill(0);
        await setImmediate();
      }
    });

    for (const action of ["close", "abort"] as const) {
      it(`${action} before attachment settles readiness and releases listeners`, async () => {
        const controller = new AbortController();
        const timersBefore = process.getActiveResourcesInfo().filter((kind) =>
          kind === "Timeout"
        ).length;
        const bootstrap = await startExecutorNodeBootstrap({
          operations,
          signal: controller.signal,
          environment: environment(),
          readKey: () => Promise.resolve(randomBytes(32)),
        });
        const closed = assertRejects(() => bootstrap.ready, Error, "Executor bootstrap");
        if (action === "abort") controller.abort(new Error("synthetic-private-reason"));
        else bootstrap.close();
        bootstrap.close();
        await closed;
        await setImmediate();
        assertEquals(getEventListeners(controller.signal, "abort").length, 0);
        assertEquals(
          process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length,
          timersBefore,
        );
      });

      it(`${action} after attachment aborts a pending operation and both channels`, async () => {
        const controller = new AbortController();
        const started = Promise.withResolvers<AbortSignal>();
        const key = randomBytes(32);
        const bootstrap = await startExecutorNodeBootstrap({
          operations: new Map([["pending", {
            mode: "unary",
            handle(_input, context) {
              started.resolve(context.signal);
              return new Promise((_resolve, reject) =>
                context.signal.addEventListener(
                  "abort",
                  () => reject(new Error("synthetic cancellation")),
                  { once: true },
                )
              );
            },
          }]]),
          signal: controller.signal,
          environment: environment(),
          readKey: () => Promise.resolve(new Uint8Array(key)),
        });
        const caller = await connectCaller(8081, key);
        try {
          const server = await bootstrap.ready;
          const call = caller.request("pending", {});
          const rejected = assertRejects(() => call, Error);
          const signal = await started.promise;
          if (action === "abort") controller.abort();
          else bootstrap.close();
          bootstrap.close();
          await Promise.all([rejected, caller.closed, server.closed]);
          assertEquals(signal.aborted, true);
          assertEquals(getEventListeners(controller.signal, "abort").length, 0);
        } finally {
          bootstrap.close();
          caller.close();
          key.fill(0);
          await setImmediate();
        }
      });
    }

    it("aborts pending key acquisition and wipes bytes from a late reader", async () => {
      const controller = new AbortController();
      const reading = Promise.withResolvers<void>();
      const key = Promise.withResolvers<Uint8Array>();
      let readerSignal: AbortSignal | undefined;
      const startup = startExecutorNodeBootstrap({
        operations,
        signal: controller.signal,
        environment: environment(),
        readKey(signal) {
          readerSignal = signal;
          reading.resolve();
          return key.promise;
        },
      });
      const rejected = assertRejects(() => startup, Error, "Executor bootstrap aborted");
      await reading.promise;
      controller.abort();
      await rejected;
      assertEquals(readerSignal?.aborted, true);
      assertEquals(getEventListeners(controller.signal, "abort").length, 0);
      const bytes = randomBytes(32);
      key.resolve(bytes);
      await setImmediate();
      assert(bytes.every((byte) => byte === 0));
    });

    it("rejects already-aborted startup before reading a key", async () => {
      let reads = 0;
      await assertRejects(
        () =>
          startExecutorNodeBootstrap({
            operations,
            environment: environment(),
            signal: AbortSignal.abort(),
            readKey: () => {
              reads++;
              return Promise.resolve(randomBytes(32));
            },
          }),
        Error,
        "Executor bootstrap aborted",
      );
      assertEquals(reads, 0);
    });

    it("accepts the maximum canonical generation and workload lifetime", async () => {
      const bootstrap = await startExecutorNodeBootstrap({
        operations,
        environment: environment({
          VERYFRONT_EXECUTOR_GENERATION: String(Number.MAX_SAFE_INTEGER),
          VERYFRONT_EXECUTOR_ACTIVE_DEADLINE_SECONDS: "86400",
        }),
        readKey: () => Promise.resolve(randomBytes(32)),
      });
      const closed = assertRejects(() => bootstrap.ready, Error, "Executor bootstrap closed");
      bootstrap.close();
      await closed;
      await setImmediate();
    });

    it("enforces the validated workload lifetime before attachment", async () => {
      const bootstrap = await startExecutorNodeBootstrap({
        operations,
        environment: environment({ VERYFRONT_EXECUTOR_ACTIVE_DEADLINE_SECONDS: "1" }),
        readKey: () => Promise.resolve(randomBytes(32)),
      });
      try {
        await assertRejects(() => bootstrap.ready, Error, "Executor bootstrap deadline exceeded");
      } finally {
        bootstrap.close();
        await setImmediate();
      }
    });

    it("limits authenticated channel readiness to the absolute allocation deadline", async () => {
      const key = randomBytes(32);
      const bootstrap = await startExecutorNodeBootstrap({
        operations,
        environment: environment({ VERYFRONT_EXECUTOR_HARD_DEADLINE_AT: String(Date.now() + 100) }),
        readKey: () => Promise.resolve(new Uint8Array(key)),
      });
      const transport = await connectExecutorTransport({
        podIp: "127.0.0.1",
        port: 8081,
        key,
        binding,
        timeoutMs: 1_000,
      });
      const watchdog = setTimeout(() => bootstrap.close(), 500);
      try {
        await assertRejects(() => bootstrap.ready, Error, "Executor bootstrap deadline exceeded");
        await assertRejects(async () => {
          const reader = transport.readable.getReader();
          try {
            while (!(await reader.read()).done) { /* Drain the server hello before closure. */ }
          } finally {
            reader.releaseLock();
          }
        }, Error);
      } finally {
        clearTimeout(watchdog);
        bootstrap.close();
        transport.close();
        key.fill(0);
        await setImmediate();
      }
    });

    it("caps channel calls and closes attached I/O at the allocation deadline", async () => {
      const key = randomBytes(32);
      const hardDeadlineAt = Date.now() + 200;
      const bootstrap = await startExecutorNodeBootstrap({
        operations,
        environment: environment({ VERYFRONT_EXECUTOR_HARD_DEADLINE_AT: String(hardDeadlineAt) }),
        readKey: () => Promise.resolve(new Uint8Array(key)),
      });
      const caller = await connectCaller(8081, key);
      let watchdogUsed = false;
      const watchdog = setTimeout(() => {
        watchdogUsed = true;
        bootstrap.close();
      }, 500);
      try {
        const server = await bootstrap.ready;
        const remaining = await caller.request("remaining", {}, { timeoutMs: 45_000 });
        assert(typeof remaining === "number" && remaining <= 200);
        await Promise.all([caller.closed, server.closed]);
        assertEquals(caller.signal.aborted, true);
        assertEquals(server.signal.aborted, true);
        assertEquals(watchdogUsed, false);
      } finally {
        clearTimeout(watchdog);
        bootstrap.close();
        caller.close();
        key.fill(0);
        await setImmediate();
      }
    });
  });
}
