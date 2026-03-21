import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { z } from "zod";
import { INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES } from "#veryfront/internal-agents/request-body.ts";
import { InternalWorkflowsListHandler } from "./internal-workflows-list.handler.ts";
import { createControlPlaneSignature, createCtx } from "./internal-agent-run.test-helpers.ts";

describe("server/handlers/request/internal-workflows-list.handler", () => {
  it("returns discovered workflows for a valid signed request", async () => {
    let discoveryCalls = 0;
    const handler = new InternalWorkflowsListHandler({
      discoverWorkflows: async () => {
        discoveryCalls += 1;
        return {
          workflows: [
            {
              id: "publish-site",
              filePath: "app/workflows/publish-site.ts",
              exportName: "default",
              definition: {
                id: "publish-site",
                description: "Build and publish the site",
                version: "3",
                inputSchema: z.object({
                  dryRun: z.boolean().optional(),
                }),
                steps: [],
              },
            },
          ],
          errors: [],
        };
      },
    });

    const body = JSON.stringify({
      requestId: "workflows-1",
      projectId: "proj-1",
      surface: "studio",
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "workflows-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/workflows/list", {
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
      workflows: [
        {
          id: "publish-site",
          name: "publish-site",
          description: "Build and publish the site",
          target: "workflow:publish-site",
          sourcePath: "app/workflows/publish-site.ts",
          version: "3",
          inputSchema: {
            properties: {
              dryRun: { type: "boolean" },
            },
            type: "object",
          },
          outputSchema: null,
          schedulable: true,
        },
      ],
    });
  });

  it("returns 401 when the control-plane signature is missing", async () => {
    const handler = new InternalWorkflowsListHandler({
      discoverWorkflows: async () => ({ workflows: [], errors: [] }),
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/workflows/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "workflows-1",
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
    const handler = new InternalWorkflowsListHandler({
      discoverWorkflows: async () => ({ workflows: [], errors: [] }),
    });

    const body = JSON.stringify({
      requestId: "workflows-body",
      projectId: "proj-1",
      surface: "studio",
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "workflows-signed",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/workflows/list", {
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
    const handler = new InternalWorkflowsListHandler({
      discoverWorkflows: async () => ({ workflows: [], errors: [] }),
    });

    const body = JSON.stringify({
      requestId: "workflows-1",
      projectId: "proj-1",
      surface: "studio",
      metadata: "x".repeat(INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES + 1024),
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "workflows-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/workflows/list", {
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
    const handler = new InternalWorkflowsListHandler({
      discoverWorkflows: async () => ({ workflows: [], errors: [] }),
    });

    const body = JSON.stringify({
      requestId: "workflows-1",
      projectId: "proj-1",
      surface: 123,
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "workflows-1",
    });

    const result = await handler.handle(
      new Request("https://example.com/internal/workflows/list", {
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
    assertEquals(await result.response.json(), { error: "Invalid internal workflows request" });
  });
});
