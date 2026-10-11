import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import {
  installMockFetch,
  observeFetchRequestInit,
  restoreMockFetch,
} from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontError } from "#veryfront/errors";
import { Sandbox } from "../../../src/sandbox/sandbox.ts";
import { currentSandboxCleanupPolicy } from "../../../src/sandbox/proxy-routes.ts";

const options = { apiUrl: "http://127.0.0.1:43210", authToken: "fixture-token" };
const problem = {
  type: "https://api.veryfront.com/errors/validation-failed",
  title: "Validation Failed",
  status: 400,
  slug: "validation-failed",
  category: "VALIDATION",
  detail: "sandbox_id: Invalid uuid",
};
function reply(body: unknown, status: number) {
  installMockFetch(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/problem+json" },
    })
  );
}
async function rejected(run: () => Promise<unknown>) {
  const error = await assertRejects(run);
  assertInstanceOf(error, VeryfrontError);
  return error;
}
describe("Sandbox HTTP error projection", () => {
  afterEach(restoreMockFetch);
  for (
    const [name, run] of [
      ["get", () => Sandbox.get("not-a-uuid", options)],
      ["list", () => Sandbox.list({ ...options, limit: 0 })],
      ["control-plane", () => Sandbox.capabilities(options)],
    ] as const
  ) {
    it(`${name} preserves HTTP classification and machine-readable problem with the SDK error identity`, async () => {
      reply(problem, 400);
      const error = await rejected(run);
      assertEquals(error.status, 400);
      assertEquals(error.slug, "request-error");
      assertEquals(error.category, "SERVER");
      assertEquals(error.context, { responseProblem: problem });
      assertStringIncludes(error.detail ?? "", "400");
    });
  }
  const attached = () => Sandbox.attach({ ...options, id: "fixture", endpoint: options.apiUrl });
  for (
    const [name, run] of [
      ["command", () => attached().runCommand("true")],
      ["file read", () => attached().readFile("/workspace/fixture")],
      [
        "file writes",
        () => attached().writeFiles([{ path: "/workspace/fixture", content: "fixture" }]),
      ],
      ["background start", () => attached().startBackgroundCommand("true")],
      ["background get", () => attached().getBackgroundCommand("command")],
      ["background output", () => attached().getBackgroundCommandOutput("command")],
      ["background list", () => attached().listBackgroundCommands()],
      ["background cancel", () => attached().cancelBackgroundCommand("command")],
      ["heartbeat", () => attached().heartbeat()],
      ["delete", () => attached().delete()],
      ["environment", () => attached().getEnvironment()],
      ["file list", () => attached().listFiles()],
      ["health", () => attached().checkHealth()],
      ["readiness", () => attached().checkReadiness()],
      ["lifetime", () => attached().updateLifetime({ ttlMode: "default" })],
      ["command stream", async () => {
        for await (const _ of attached().streamCommand("true")) { /* drain */ }
      }],
    ] as const
  ) {
    it(`${name} retains authorization-denial status and canonical metadata`, async () => {
      const denied = { ...problem, status: 403, slug: "authorization-denied", category: "AUTH" };
      reply(denied, 403);
      const error = await rejected(run);
      assertEquals(error.status, 403);
      assertEquals(error.context, { responseProblem: denied });
    });
  }
  for (
    const [name, run] of [
      [
        "cleanup",
        (signal: AbortSignal) =>
          currentSandboxCleanupPolicy({ ...options, sessionId: "fixture", signal }),
      ],
      ["delete", (signal: AbortSignal) => attached().delete({ signal })],
      [
        "background cancel",
        (signal: AbortSignal) => attached().cancelBackgroundCommand("command", { signal }),
      ],
    ] as const
  ) {
    it(`${name} error-body reads stay inside the caller's cancellation boundary`, async () => {
      const controller = new AbortController();
      installMockFetch(async () =>
        new Response(
          new ReadableStream({
            pull() {
              controller.abort(new Error("cleanup canceled"));
            },
          }, { highWaterMark: 0 }),
          { status: 403 },
        )
      );
      const error = await rejected(() => run(controller.signal));
      assertEquals(error.status, 403);
      assertInstanceOf(error.cause, Error);
      assertStringIncludes(error.cause.message, "cleanup canceled");
    });
  }
  it("LazySandbox heartbeat preserves HTTP status and problem details when cleanup is disabled", async () => {
    let heartbeats = 0;
    const denied = { ...problem, status: 403, slug: "authorization-denied", category: "AUTH" };
    installMockFetch(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/sandboxes" && observeFetchRequestInit(init).method === "POST") {
        return new Response(
          JSON.stringify({
            id: "lazy-fixture",
            endpoint: options.apiUrl,
            status: "running",
            workspace_storage: "ephemeral",
            ttl_mode: "default",
          }),
          { status: 201 },
        );
      }
      if (path.endsWith("/heartbeat")) {
        return heartbeats++ === 0
          ? new Response(JSON.stringify({ ok: true }), { status: 200 })
          : new Response(JSON.stringify(denied), { status: 403 });
      }
      if (path.endsWith("/readyz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`Unexpected fixture request ${path}`);
    });
    const sandbox = Sandbox.createLazy({
      ...options,
      projectReference: "fixture-project",
      deleteOnClose: false,
    });
    try {
      await sandbox.ensure();
      const error = await rejected(() => sandbox.heartbeat(true));
      assertEquals(error.status, 403);
      assertEquals(error.context, { responseProblem: denied });
      assertEquals(sandbox.id, "lazy-fixture");
    } finally {
      await sandbox.close();
    }
  });
  it("does not expose opaque response fields to a replaced JSON parser", async () => {
    const original = JSON.parse;
    const marker = "opaque-response-parser-secret";
    let observed = false;
    reply({ debug: marker }, 500);
    JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
      if (args[0].includes(marker)) observed = true;
      return original(...args);
    };
    try {
      await rejected(() => Sandbox.get("fixture", options));
      assertEquals(observed, false);
    } finally {
      JSON.parse = original;
    }
  });
  it("does not expose opaque response objects to inherited property accessors", async () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "status");
    const own = Object.getOwnPropertyDescriptor;
    const define = Object.defineProperty;
    const marker = "opaque-response-prototype-secret";
    let observed = false;
    reply({ debug: marker }, 500);
    define(Object.prototype, "status", {
      configurable: true,
      get() {
        if (own(this, "debug")?.value === marker) observed = true;
        return undefined;
      },
      set(value: unknown) {
        define(this, "status", { value, configurable: true, writable: true, enumerable: true });
      },
    });
    try {
      await rejected(() => Sandbox.get("fixture", options));
      assertEquals(observed, false);
    } finally {
      if (original) define(Object.prototype, "status", original);
      else Reflect.deleteProperty(Object.prototype, "status");
    }
  });
  it("does not replay an HTTP command failure whose problem text says fetch failed", async () => {
    let commands = 0;
    const session = {
      id: "command-fixture",
      endpoint: options.apiUrl,
      status: "running",
      workspace_storage: "ephemeral",
      ttl_mode: "default",
    };
    const failure = {
      ...problem,
      status: 403,
      detail: "fetch failed after the command response began",
    };
    installMockFetch(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/commands/stream")) {
        commands++;
        return new Response(JSON.stringify(failure), { status: 403 });
      }
      if (path.endsWith("/heartbeat") || path.endsWith("/readyz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (path === "/sandboxes" || path === "/sandboxes/command-fixture") {
        return new Response(JSON.stringify(session), { status: 200 });
      }
      throw new Error(`Unexpected fixture request ${path}`);
    });
    const sandbox = Sandbox.createLazy({
      ...options,
      projectReference: "fixture-project",
      deleteOnClose: false,
      execStartMaxAttempts: 2,
      execStartRetryDelayMs: 0,
    });
    try {
      const error = await rejected(() =>
        (async () => {
          for await (const _event of sandbox.streamCommand("fixture command")) {
            /* exhaust stream */
          }
        })()
      );
      assertEquals(error.status, 403);
      assertEquals(
        commands,
        1,
        "An HTTP response must not be treated as a pre-response network failure",
      );
    } finally {
      await sandbox.close();
    }
  });
  it("does not reprovision or replay after an HTTP error body connection reset", async () => {
    let commands = 0;
    const session = {
      id: "command-fixture",
      endpoint: options.apiUrl,
      status: "running",
      workspace_storage: "ephemeral",
      ttl_mode: "default",
    };
    installMockFetch(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/commands/stream")) {
        commands++;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(Object.assign(new Error("body reset"), { code: "ECONNRESET" }));
            },
          }),
          { status: 503 },
        );
      }
      if (path.endsWith("/heartbeat") || path.endsWith("/readyz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (path === "/sandboxes" || path === "/sandboxes/command-fixture") {
        return new Response(JSON.stringify(session), { status: 200 });
      }
      throw new Error(`Unexpected fixture request ${path}`);
    });
    const sandbox = Sandbox.createLazy({
      ...options,
      projectReference: "fixture-project",
      deleteOnClose: false,
      execStartMaxAttempts: 1,
      execStartRetryDelayMs: 0,
    });
    try {
      const error = await rejected(() =>
        (async () => {
          for await (const _event of sandbox.streamCommand("fixture command")) {
            /* exhaust stream */
          }
        })()
      );
      assertEquals(error.status, 503);
      assertEquals(
        commands,
        1,
        "An HTTP response must not be treated as a pre-response network failure",
      );
    } finally {
      await sandbox.close();
    }
  });
  it("does not replay a proxy command after an HTTP error body host failure", async () => {
    let commands = 0;
    const session = {
      id: "command-fixture",
      endpoint: options.apiUrl,
      status: "running",
      workspace_storage: "ephemeral",
      ttl_mode: "default",
    };
    installMockFetch(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/commands/run")) {
        commands++;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(Object.assign(new Error("body reset"), { code: "EHOSTUNREACH" }));
            },
          }),
          { status: 503 },
        );
      }
      if (path.endsWith("/heartbeat") || path.endsWith("/readyz")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (path === "/sandboxes" || path === "/sandboxes/command-fixture") {
        return new Response(JSON.stringify(session), { status: 200 });
      }
      throw new Error(`Unexpected fixture request ${path}`);
    });
    const sandbox = Sandbox.createLazy({
      ...options,
      projectReference: "fixture-project",
      deleteOnClose: false,
      execStartMaxAttempts: 2,
      execStartRetryDelayMs: 0,
    });
    try {
      const error = await rejected(() => sandbox.runCommand("fixture command"));
      assertEquals(error.status, 503);
      assertEquals(
        commands,
        1,
        "An HTTP response must not be treated as a pre-response network failure",
      );
    } finally {
      await sandbox.close();
    }
  });
});
