import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import "#veryfront/schemas/_test-setup.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { IntegrationClient, IntegrationConnectionStatus } from "veryfront/integrations";
import { createIntegrationClient } from "../../../src/integrations/client.ts";
import {
  MAX_INTEGRATION_CONNECTION_WAIT_MS,
  waitForIntegrationConnection,
} from "../../../src/integrations/connection-wait.ts";

const before: IntegrationConnectionStatus = {
  connected: true,
  integration: "github",
  scope: "user",
  connection_id: "account",
  connection_generation_id: "old",
};

function fakeClient(generationAt: (read: number) => string, scope = "user") {
  let reads = 0;
  const client: Pick<IntegrationClient, "status" | "listConnections"> = {
    status: (_integration, _scope, options) => {
      options?.abortSignal?.throwIfAborted();
      reads++;
      return Promise.resolve({ ...before, connection_generation_id: generationAt(reads) });
    },
    listConnections: async function* () {
      yield {
        id: "account",
        integration: "github",
        scope: scope as "user",
        status: "connected" as const,
        connection_generation_id: generationAt(reads),
      };
    },
  };
  return { client, reads: () => reads };
}

describe("bounded connection wait", () => {
  it("confirms only a new generation that a connected row of the scope matches", async () => {
    const { client, reads } = fakeClient((read) => (read >= 2 ? "new" : "old"));
    const outcome = await waitForIntegrationConnection(client, "github", {
      scope: "user",
      before,
      timeoutMs: 5000,
    });
    assertEquals(outcome.status, "connection_observed");
    if (outcome.status === "connection_observed") {
      assertEquals(outcome.connection.connection_generation_id, "new");
    }
    assertEquals(reads(), 2);
  });

  it("times out when only the preexisting generation is visible", async () => {
    const { client } = fakeClient(() => "old");
    assertEquals(
      await waitForIntegrationConnection(client, "github", {
        scope: "user",
        before,
        timeoutMs: 300,
      }),
      { status: "timed_out", integration: "github", scope: "user" },
    );
  });

  it("does not treat a disconnected baseline that reconnects unchanged as new consent", async () => {
    const { client } = fakeClient(() => "old");
    assertEquals(
      (await waitForIntegrationConnection(client, "github", {
        scope: "user",
        before: { ...before, connected: false },
        timeoutMs: 300,
      })).status,
      "timed_out",
    );
  });

  it("does not treat a casing change of the same identity as new consent", async () => {
    const { client } = fakeClient(() => "OLD");
    assertEquals(
      (await waitForIntegrationConnection(client, "github", {
        scope: "user",
        before,
        timeoutMs: 300,
      }))
        .status,
      "timed_out",
    );
  });

  it("does not accept a new generation from another scope", async () => {
    const { client } = fakeClient(() => "new", "project");
    assertEquals(
      (await waitForIntegrationConnection(client, "github", {
        scope: "user",
        before,
        timeoutMs: 300,
      }))
        .status,
      "timed_out",
    );
  });

  it("propagates caller cancellation instead of reporting a timeout", async () => {
    const { client } = fakeClient(() => "old");
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("cancelled", "AbortError")), 50);
    await assertRejects(
      () =>
        waitForIntegrationConnection(client, "github", {
          scope: "user",
          before,
          timeoutMs: 5000,
          abortSignal: controller.signal,
        }),
      DOMException,
      "cancelled",
    );
  });

  it("rejects unbounded, implicit or mismatched waits before any read", async () => {
    const { client, reads } = fakeClient(() => "new");
    for (const timeoutMs of [0, 1.5, MAX_INTEGRATION_CONNECTION_WAIT_MS + 1]) {
      await assertRejects(
        () => waitForIntegrationConnection(client, "github", { scope: "user", timeoutMs }),
        RangeError,
      );
    }
    await assertRejects(
      () =>
        waitForIntegrationConnection(client, "github", {
          scope: undefined as unknown as "user",
          timeoutMs: 100,
        }),
      TypeError,
    );
    for (
      const baseline of [
        { ...before, integration: "gitlab" },
        { ...before, connection_generation_id: undefined },
      ]
    ) {
      await assertRejects(
        () =>
          waitForIntegrationConnection(client, "github", {
            scope: "user",
            before: baseline,
            timeoutMs: 100,
          }),
        TypeError,
      );
    }
    assertEquals(reads(), 0);
  });

  it("rejects a baseline from another scope or without scope before polling", async () => {
    const { client, reads } = fakeClient(() => "new");
    for (
      const baseline of [{ ...before, scope: "project" as const }, { ...before, scope: undefined }]
    ) {
      await assertRejects(
        () =>
          waitForIntegrationConnection(client, "github", {
            scope: "user",
            before: baseline,
            timeoutMs: 5000,
          }),
        TypeError,
        "same scope",
      );
    }
    assertEquals(reads(), 0);
  });

  it("observes the new generation through the project-bound client", async () => {
    const project = { id: "11111111-1111-4111-8111-111111111111", slug: "test-project" };
    const id = "22222222-2222-4222-8222-222222222222";
    const generations = [
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ];
    let statusReads = 0;
    await withMockFetch(async (input) => {
      const url = new URL(String(input));
      const headers = { "x-veryfront-project-id": project.id };
      if (url.pathname === `/projects/${project.id}`) return Response.json(project);
      if (url.pathname === "/integrations/tools/list") {
        return Response.json({ tools: [] }, { headers });
      }
      const generation = generations[Math.min(statusReads, 1)];
      if (url.pathname === "/oauth/status/github") {
        assertEquals(url.searchParams.get("scope"), "user");
        statusReads++;
        return Response.json({
          connected: true,
          integration: "github",
          scope: "project",
          connection_id: id,
          connection_generation_id: generations[Math.min(statusReads - 1, 1)],
        });
      }
      return Response.json({
        data: [{
          id,
          integration: "github",
          scope: "user",
          status: "connected",
          connection_generation_id: generation,
        }],
        page_info: { next: null },
      });
    }, async () => {
      const client = await createIntegrationClient({
        apiBaseUrl: "https://api.example.test",
        authToken: "synthetic-token",
        projectReference: project.id,
      });
      const pre = await client.status("github", "user");
      assertEquals(pre.scope, "user");
      await assertRejects(
        () =>
          client.waitForConnection("github", { scope: "project", before: pre, timeoutMs: 5000 }),
        TypeError,
        "same scope",
      );
      assertEquals(statusReads, 1);
      const outcome = await client.waitForConnection("github", {
        scope: "user",
        before: pre,
        timeoutMs: 5000,
      });
      assertEquals(outcome.status, "connection_observed");
      assertEquals(statusReads, 2);
    });
  });
});
