import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import {
  installMockFetch,
  observeFetchRequestInit,
  restoreMockFetch,
} from "#veryfront/testing/mock-fetch.ts";
import { Sandbox } from "../../../src/sandbox/sandbox.ts";

describe("Sandbox command dispatch uncertainty", () => {
  afterEach(restoreMockFetch);

  for (
    const [method, errorShape] of ["proxy-command", "proxy-stream", "runtime-command"].flatMap(
      (method) => ["native-wrapper", "direct-pinned"].map((shape) => [method, shape] as const),
    )
  ) {
    const commandPath = method === "proxy-command"
      ? "/commands/run"
      : method === "proxy-stream"
      ? "/commands/stream"
      : "/exec";
    for (
      const code of [
        undefined,
        "ECONNRESET",
        "ETIMEDOUT",
        "EPIPE",
        "ECONNREFUSED",
        "EHOSTUNREACH",
        "ACCESSOR-CODE",
        "ACCESSOR-SYSCALL",
        "CONFLICTING-CAUSE",
      ]
    ) {
      it(`${method} ${errorShape} does not replay a dispatched command after ${code ?? "an unclassified fetch failure"}`, async () => {
        let executions = 0;
        let reconnects = 0;
        let getterCalls = 0;
        const cause = code
          ? {
            code: code === "ACCESSOR-SYSCALL"
              ? "ECONNREFUSED"
              : code === "CONFLICTING-CAUSE"
              ? "ECONNRESET"
              : code,
            ...(code === "CONFLICTING-CAUSE"
              ? { cause: { code: "ECONNREFUSED", syscall: "connect" } }
              : {}),
            ...(code === "EHOSTUNREACH" ? { syscall: "write" } : {}),
            ...(code === "ECONNREFUSED" ? { syscall: "read" } : {}),
            ...(code === "ACCESSOR-CODE" ? { syscall: "connect" } : {}),
          }
          : undefined;
        if (cause && (code === "ACCESSOR-CODE" || code === "ACCESSOR-SYSCALL")) {
          Object.defineProperty(cause, code === "ACCESSOR-CODE" ? "code" : "syscall", {
            get() {
              getterCalls++;
              throw new Error("Transport metadata getter must not run");
            },
          });
        }
        const failure = errorShape === "direct-pinned"
          ? Object.defineProperties(
            new Error("fetch failed"),
            cause ? Object.getOwnPropertyDescriptors(cause) : {},
          )
          : new TypeError("fetch failed", cause ? { cause } : undefined);
        const endpoint = "http://127.0.0.1:43210";
        const session = {
          id: "retry-fixture",
          endpoint,
          status: "running",
          workspace_storage: "ephemeral",
          ttl_mode: "default",
        };
        installMockFetch(async (input) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith(commandPath)) {
            // The server dispatched the side effect, but its response never reached the client.
            executions++;
            throw failure;
          }
          if (path.endsWith("/heartbeat")) {
            return Response.json({ ok: true });
          }
          if (path === "/sandboxes/retry-fixture") {
            reconnects++;
            return Response.json(session);
          }
          if (path === "/sandboxes") return Response.json(session);
          throw new Error(`Unexpected fixture request ${path}`);
        });
        const sandbox = Sandbox.createLazy({
          apiUrl: endpoint,
          authToken: "fixture-token",
          projectReference: "fixture-project",
          deleteOnClose: false,
          execStartMaxAttempts: 2,
          execStartRetryDelayMs: 0,
          ...(method === "runtime-command"
            ? { resolveRuntimeEndpoint: () => "http://127.0.0.1:43211" }
            : {}),
        });
        try {
          const error = await assertRejects(
            () =>
              method === "proxy-stream"
                ? Array.fromAsync(sandbox.streamCommand("fixture side effect"))
                : sandbox.runCommand("fixture side effect"),
            errorShape === "direct-pinned" ? Error : TypeError,
            "fetch failed",
          );
          assertEquals(error === failure, true, "Preserve the original uncertain failure");
          assertEquals(getterCalls, 0, "Only data properties may authorize retry");
          assertEquals(executions, 1, "An unknown dispatch outcome cannot authorize replay");
          assertEquals(reconnects, 0, "An unknown dispatch outcome cannot authorize replacement");
          assertEquals(sandbox.id, session.id);
        } finally {
          await sandbox.close();
        }
      });
    }
    for (
      const [code, syscall] of [
        ["ECONNREFUSED", "connect"],
        ["ENETUNREACH", "connect"],
        ["EHOSTUNREACH", "connect"],
        ["ENOTFOUND", "getaddrinfo"],
        ["EAI_AGAIN", "getaddrinfo"],
        ["EADDRNOTAVAIL", "connect"],
        ["EADDRNOTAVAIL", "bind"],
        ["EADDRNOTAVAIL", undefined],
        ["ETIMEDOUT", "connect"],
        ["ECONNREFUSED", undefined],
        ["ENOTFOUND", undefined],
        ["EAI_AGAIN", undefined],
      ]
    ) {
      it(`${method} ${errorShape} retries ${code} during ${syscall} before execution`, async () => {
        let requests = 0;
        let executions = 0;
        let reconnects = 0;
        const endpoint = "http://127.0.0.1:43210";
        const session = {
          id: "retry-fixture",
          endpoint,
          status: "running",
          workspace_storage: "ephemeral",
          ttl_mode: "default",
        };
        installMockFetch(async (input) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith(commandPath)) {
            requests++;
            if (requests === 1) {
              throw errorShape === "direct-pinned"
                ? Object.assign(new Error("connection setup failed"), { code, syscall })
                : new TypeError("connection setup failed", { cause: { code, syscall } });
            }
            executions++;
            return method === "proxy-command"
              ? Response.json({ stdout: "ok", stderr: "", exit_code: 0 })
              : new Response('{"type":"stdout","data":"ok"}\n{"type":"exit","exitCode":0}\n');
          }
          if (path.endsWith("/heartbeat")) return Response.json({ ok: true });
          if (path === "/sandboxes/retry-fixture") {
            reconnects++;
            return Response.json(session);
          }
          if (path === "/sandboxes") return Response.json(session);
          throw new Error(`Unexpected fixture request ${path}`);
        });
        const sandbox = Sandbox.createLazy({
          apiUrl: endpoint,
          authToken: "fixture-token",
          projectReference: "fixture-project",
          deleteOnClose: false,
          execStartMaxAttempts: 2,
          execStartRetryDelayMs: 0,
          ...(method === "runtime-command"
            ? { resolveRuntimeEndpoint: () => "http://127.0.0.1:43211" }
            : {}),
        });
        try {
          if (method === "proxy-stream") {
            const events = await Array.fromAsync(sandbox.streamCommand("fixture side effect"));
            assertEquals(events[0]?.data, "ok");
          } else assertEquals((await sandbox.runCommand("fixture side effect")).stdout, "ok");
          assertEquals(requests, 2);
          assertEquals(executions, 1);
          assertEquals(reconnects, 0);
        } finally {
          await sandbox.close();
        }
      });
    }
  }
  for (const method of ["proxy-command", "proxy-stream", "runtime-command"]) {
    it(`${method} never retries a body failure after receiving a response`, async () => {
      let commands = 0;
      const endpoint = "http://127.0.0.1:43210";
      const session = {
        id: "retry-fixture",
        endpoint,
        status: "running",
        workspace_storage: "ephemeral",
        ttl_mode: "default",
      };
      const failure = new TypeError("body transport failed", {
        cause: { code: "ECONNREFUSED", syscall: "connect" },
      });
      installMockFetch(async (input) => {
        const path = new URL(String(input)).pathname;
        if (
          path.endsWith("/commands/run") || path.endsWith("/commands/stream") ||
          path.endsWith("/exec")
        ) {
          commands++;
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(failure);
              },
            }),
            { status: 200 },
          );
        }
        if (path.endsWith("/heartbeat")) return Response.json({ ok: true });
        if (path === "/sandboxes" || path === "/sandboxes/retry-fixture") {
          return Response.json(session);
        }
        throw new Error(`Unexpected fixture request ${path}`);
      });
      const sandbox = Sandbox.createLazy({
        apiUrl: endpoint,
        authToken: "fixture-token",
        projectReference: "fixture-project",
        deleteOnClose: false,
        execStartMaxAttempts: 2,
        execStartRetryDelayMs: 0,
        ...(method === "runtime-command"
          ? { resolveRuntimeEndpoint: () => "http://127.0.0.1:43211" }
          : {}),
      });
      try {
        const error = await assertRejects(
          () =>
            method === "proxy-stream"
              ? Array.fromAsync(sandbox.streamCommand("fixture side effect"))
              : sandbox.runCommand("fixture side effect"),
          TypeError,
          "body transport failed",
        );
        assertEquals(error === failure, true);
        assertEquals(commands, 1, "Receiving a response rules out a setup-only failure");
      } finally {
        await sandbox.close();
      }
    });
  }
  for (const method of ["proxy-command", "proxy-stream", "runtime-command"]) {
    it(`${method} does not treat argument evaluation as a fetch failure`, async () => {
      let lookups = 0;
      let commands = 0;
      let reconnects = 0;
      const endpoint = "http://127.0.0.1:43210";
      const session = {
        id: "retry-fixture",
        endpoint,
        status: "running",
        workspace_storage: "ephemeral",
        ttl_mode: "default",
      };
      const failure = new TypeError("options lookup failed", {
        cause: { code: "ECONNREFUSED", syscall: "connect" },
      });
      const commandOptions = {
        get cwd(): string {
          lookups++;
          throw failure;
        },
      };
      installMockFetch(async (input) => {
        const path = new URL(String(input)).pathname;
        if (
          path.endsWith("/commands/run") || path.endsWith("/commands/stream") ||
          path.endsWith("/exec")
        ) {
          commands++;
          return Response.json({});
        }
        if (path.endsWith("/heartbeat")) return Response.json({ ok: true });
        if (path === "/sandboxes/retry-fixture") {
          reconnects++;
          return Response.json(session);
        }
        if (path === "/sandboxes") return Response.json(session);
        throw new Error(`Unexpected fixture request ${path}`);
      });
      const sandbox = Sandbox.createLazy({
        apiUrl: endpoint,
        authToken: "fixture-token",
        projectReference: "fixture-project",
        deleteOnClose: false,
        execStartMaxAttempts: 2,
        execStartRetryDelayMs: 0,
        ...(method === "runtime-command"
          ? { resolveRuntimeEndpoint: () => "http://127.0.0.1:43211" }
          : {}),
      });
      try {
        const error = await assertRejects(
          () =>
            method === "proxy-stream"
              ? Array.fromAsync(sandbox.streamCommand("fixture side effect", commandOptions))
              : sandbox.runCommand("fixture side effect", commandOptions),
          TypeError,
          "options lookup failed",
        );
        assertEquals(error === failure, true);
        assertEquals(lookups, 1);
        assertEquals(commands, 0);
        assertEquals(reconnects, 0);
      } finally {
        await sandbox.close();
      }
    });
  }
  it("preserves an SDK-created workspace after reset until explicit close", async () => {
    let creates = 0;
    let deletes = 0;
    let commands = 0;
    const endpoint = "http://127.0.0.1:43210";
    const session = {
      id: "retry-fixture",
      endpoint,
      status: "running",
      workspace_storage: "ephemeral",
      ttl_mode: "default",
    };
    installMockFetch(async (input, init) => {
      const path = new URL(String(input)).pathname;
      const method = observeFetchRequestInit(init).method;
      if (path.endsWith("/commands/stream")) {
        commands++;
        throw new TypeError("fetch failed", { cause: { code: "ECONNRESET", syscall: "read" } });
      }
      if (path === "/sandboxes" && method === "POST") {
        creates++;
        return Response.json(session);
      }
      if (path === "/sandboxes/retry-fixture" && method === "DELETE") {
        deletes++;
        return Response.json({ ok: true });
      }
      if (path.endsWith("/heartbeat")) return Response.json({ ok: true });
      throw new Error(`Unexpected fixture request ${method} ${path}`);
    });
    const sandbox = Sandbox.createLazy({
      apiUrl: endpoint,
      authToken: "fixture-token",
      projectReference: "fixture-project",
      deleteOnClose: true,
      execStartMaxAttempts: 2,
      execStartRetryDelayMs: 0,
    });
    try {
      await assertRejects(
        () => Array.fromAsync(sandbox.streamCommand("fixture side effect")),
        TypeError,
        "fetch failed",
      );
      assertEquals(commands, 1);
      assertEquals(creates, 1);
      assertEquals(deletes, 0);
      assertEquals(sandbox.id, session.id);
    } finally {
      await sandbox.close();
    }
    assertEquals(deletes, 1, "Explicit cleanup still honors the caller's policy");
  });
});
