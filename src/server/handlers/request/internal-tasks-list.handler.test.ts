import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES } from "#veryfront/internal-agents/request-body.ts";
import { InternalTasksListHandler } from "./internal-tasks-list.handler.ts";
import { createControlPlaneSignature, createCtx } from "./internal-agent-run.test-helpers.ts";

describe("server/handlers/request/internal-tasks-list.handler", () => {
  it("returns discovered tasks for a valid signed request", async () => {
    let discoveryCalls = 0;
    const handler = new InternalTasksListHandler({
      discoverTasks: async () => {
        discoveryCalls += 1;
        return {
          tasks: [
            {
              id: "sync-data",
              name: "Sync external data",
              filePath: "tasks/sync-data.ts",
              exportName: "default",
              definition: {
                name: "Sync external data",
                description: "Pull the latest records from the upstream API",
                inputSchema: {
                  type: "object",
                  properties: {
                    dryRun: { type: "boolean" },
                  },
                },
                schedulable: false,
                run: async () => undefined,
              },
            },
          ],
          errors: [],
        };
      },
    });

    const body = JSON.stringify({
      requestId: "tasks-1",
      projectId: "proj-1",
      surface: "studio",
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "tasks-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/tasks/list", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(discoveryCalls, 1);
    assertEquals(await result.response.json(), {
      tasks: [
        {
          id: "sync-data",
          name: "Sync external data",
          description: "Pull the latest records from the upstream API",
          target: "task:sync-data",
          sourcePath: "tasks/sync-data.ts",
          inputSchema: {
            type: "object",
            properties: {
              dryRun: { type: "boolean" },
            },
          },
          outputSchema: null,
          schedulable: false,
        },
      ],
    });
  });

  it("returns 401 when the control-plane signature is missing", async () => {
    const handler = new InternalTasksListHandler({
      discoverTasks: async () => ({ tasks: [], errors: [] }),
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/tasks/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "tasks-1",
          projectId: "proj-1",
          surface: "studio",
        }),
      }),
      createCtx("-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----"),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Missing control-plane signature" });
  });

  it("returns 401 when the signed claims do not match the request body", async () => {
    const handler = new InternalTasksListHandler({
      discoverTasks: async () => ({ tasks: [], errors: [] }),
    });

    const body = JSON.stringify({
      requestId: "tasks-body",
      projectId: "proj-1",
      surface: "studio",
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "tasks-signed",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/tasks/list", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Invalid control-plane signature" });
  });

  it("rejects oversized list payloads before parsing", async () => {
    const handler = new InternalTasksListHandler({
      discoverTasks: async () => ({ tasks: [], errors: [] }),
    });

    const body = JSON.stringify({
      requestId: "tasks-1",
      projectId: "proj-1",
      surface: "studio",
      metadata: "x".repeat(INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES + 1024),
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "tasks-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/tasks/list", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 413);
    assertEquals(await result.response.json(), { error: "Payload too large" });
  });

  it("returns 400 when the request body shape is invalid", async () => {
    const handler = new InternalTasksListHandler({
      discoverTasks: async () => ({ tasks: [], errors: [] }),
    });

    const body = JSON.stringify({
      requestId: "tasks-1",
      projectId: "proj-1",
      surface: 123,
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "tasks-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/tasks/list", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(await result.response.json(), { error: "Invalid internal tasks request" });
  });
});
