import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CONTROL_PLANE_RUNTIME_CAPABILITIES_PATH as path } from "#veryfront/channels/control-plane.ts";
import { RuntimeCapabilitiesHandler } from "./runtime-capabilities.handler.ts";
import { createControlPlaneSignature, createCtx } from "./internal-agent-run.test-helpers.ts";

const payload = { requestId: "capabilities-1", projectId: "proj-1", surface: "studio" };
async function signed(body = JSON.stringify(payload), signaturePath = path) {
  const signature = await createControlPlaneSignature(body, {
    requestMethod: "POST",
    requestPath: signaturePath,
    requestId: payload.requestId,
  });
  return {
    ctx: createCtx(signature.publicKeyPem),
    req: new Request(`https://example.com${path}`, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-veryfront-control-plane-jws": signature.jws,
      },
    }),
  };
}

describe("runtime capabilities metadata", () => {
  it("reports the exact-entrypoint protocol without touching source files or tenant configuration", async () => {
    const { req, ctx } = await signed();
    // Any attempt at source discovery or config evaluation must fail this operation.
    ctx.adapter.fs = new Proxy(ctx.adapter.fs, {
      get(target, key, receiver) {
        if (
          ["readFile", "readTextFile", "readDir", "readdir"].includes(String(key))
        ) throw new Error("Source access forbidden");
        return Reflect.get(target, key, receiver);
      },
    });
    const result = await new RuntimeCapabilitiesHandler().handle(req, ctx);
    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      project_id: "proj-1",
      capabilities: { account_agent_publications: { version: 1 } },
    });
  });

  it("does not advertise execution on a shared host without isolation authority", async () => {
    const { req, ctx } = await signed();
    ctx.prepareHostedConfigContext = async () => {
      throw new Error("No tenant config may run");
    };
    const result = await new RuntimeCapabilitiesHandler().handle(req, ctx);
    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), { project_id: "proj-1", capabilities: {} });
  });

  it("advertises on a shared host only when the operator allows project code execution", async () => {
    const { req, ctx } = await signed();
    ctx.prepareHostedConfigContext = async () => {
      throw new Error("No tenant config may run");
    };
    ctx.allowHostProjectCodeExecution = true;
    const result = await new RuntimeCapabilitiesHandler().handle(req, ctx);
    assertExists(result.response);
    assertEquals(await result.response.json(), {
      project_id: "proj-1",
      capabilities: { account_agent_publications: { version: 1 } },
    });
  });

  it("rejects unsigned requests", async () => {
    const { ctx } = await signed();
    const result = await new RuntimeCapabilitiesHandler().handle(
      new Request(`https://example.com${path}`, { method: "POST", body: JSON.stringify(payload) }),
      ctx,
    );
    assertExists(result.response);
    assertEquals(result.response.status, 401);
  });

  for (const mismatch of ["context", "project", "subject", "operation", "body"] as const) {
    it(`rejects a mismatched ${mismatch}`, async () => {
      const body = JSON.stringify({
        ...payload,
        ...(mismatch === "project" ? { projectId: "other-project" } : {}),
        ...(mismatch === "subject" ? { requestId: "other-request" } : {}),
      });
      const { req, ctx } = await signed(
        body,
        mismatch === "operation" ? "/api/control-plane/agents/list" : path,
      );
      if (mismatch === "context") ctx.projectId = "other-project";
      const request = mismatch === "body"
        ? new Request(req.url, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify({ ...payload, projectId: "altered" }),
        })
        : req;
      const result = await new RuntimeCapabilitiesHandler().handle(request, ctx);
      assertExists(result.response);
      assertEquals(result.response.status, 401);
    });
  }

  it("bounds metadata request size", async () => {
    const { req, ctx } = await signed(JSON.stringify({ ...payload, padding: "x".repeat(4096) }));
    const result = await new RuntimeCapabilitiesHandler().handle(req, ctx);
    assertExists(result.response);
    assertEquals(result.response.status, 413);
  });
});
