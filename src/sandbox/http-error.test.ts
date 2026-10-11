import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontError } from "#veryfront/errors";
import { Sandbox } from "./sandbox.ts";
import { currentSandboxCleanupPolicy } from "./proxy-routes.ts";

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
  it("does not accept a conflicting problem status or unexpected response metadata", async () => {
    reply({ ...problem, status: 200, credentials: "untrusted extra metadata" }, 403);
    const error = await rejected(() => Sandbox.get("fixture", options));
    assertEquals(error.status, 403);
    assertEquals(error.context, undefined);
  });
  it("keeps malformed server bodies visible without inventing a canonical problem", async () => {
    installMockFetch(async () => new Response("gateway unavailable", { status: 503 }));
    const error = await rejected(() => Sandbox.get("fixture", options));
    assertEquals(error.status, 503);
    assertEquals(error.context, undefined);
    assertStringIncludes(error.detail ?? "", "gateway unavailable");
  });
  it("projects only bounded problem fields, not arbitrary remote metadata", async () => {
    reply({ ...problem, credentials: "untrusted extra metadata", debug: { arbitrary: true } }, 400);
    const error = await rejected(() => Sandbox.get("fixture", options));
    assertEquals(error.context, { responseProblem: problem });
  });
  it("preserves body-read failure as a visible cause with the response status", async () => {
    installMockFetch(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("fixture body read failure"));
          },
        }),
        { status: 502 },
      )
    );
    const error = await rejected(() => Sandbox.get("fixture", options));
    assertEquals(error.status, 502);
    assertInstanceOf(error.cause, Error);
    assertStringIncludes(error.cause.message, "fixture body read failure");
    assertStringIncludes(error.detail ?? "", "response body unavailable");
  });
  it("bounds oversized diagnostics and never trusts a truncated canonical problem", async () => {
    installMockFetch(async () =>
      new Response(JSON.stringify(problem) + " ".repeat(16_384), { status: 400 })
    );
    const error = await rejected(() => Sandbox.get("fixture", options));
    assertEquals(error.status, 400);
    assertEquals(error.context, { responseTruncated: true });
    assertStringIncludes(error.detail ?? "", "[truncated]");
    assertEquals((error.detail ?? "").length < 8 * 1024 + 100, true);
  });
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
});
