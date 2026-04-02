import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import type { HandlerContext } from "#veryfront/types";
import { runWithProjectEnv } from "../server/project-env/storage.ts";
import {
  createControlPlaneSignature,
  createCtx as createVerificationCtx,
} from "../server/handlers/request/internal-agent-run.test-helpers.ts";
import {
  ControlPlaneRequestError,
  getControlPlaneVerificationPublicKey,
  verifyControlPlaneRequest,
} from "./control-plane-auth.ts";

function createCtx(envGet: (key: string) => string | undefined): HandlerContext {
  return {
    adapter: {
      env: {
        get: envGet,
        set: () => {},
        toObject: () => ({}),
      },
      fs: {},
    },
  } as unknown as HandlerContext;
}

describe("internal-agents/control-plane-auth", () => {
  it("prefers adapter-provided verification keys", () => {
    const ctx = createCtx((key) =>
      key === "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY" ? "adapter-key" : undefined
    );

    assertEquals(getControlPlaneVerificationPublicKey(ctx), "adapter-key");
  });

  it("falls back to host env when project overlays hide adapter env reads", () => {
    const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
    const originalValue = Deno.env.get(envKey);
    Deno.env.set(envKey, "host-key");

    try {
      const ctx = createCtx((key) => getEnv(key));
      const resolvedKey = runWithProjectEnv({}, () => getControlPlaneVerificationPublicKey(ctx));
      assertEquals(resolvedKey, "host-key");
    } finally {
      if (originalValue === undefined) {
        Deno.env.delete(envKey);
      } else {
        Deno.env.set(envKey, originalValue);
      }
    }
  });

  it("verifies signed control-plane requests", async () => {
    const rawBody = JSON.stringify({ runId: "run-1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(rawBody, {
      requestId: "run-1",
      surface: "studio",
    });
    const request = new Request("https://veryfront.test/internal/agents/stream", {
      headers: { "x-veryfront-control-plane-jws": jws },
    });

    const claims = await verifyControlPlaneRequest(
      request,
      createVerificationCtx(publicKeyPem),
      rawBody,
      { expectedSubject: "run-1", expectedSurface: "studio" },
    );

    assertEquals(claims.sub, "run-1");
    assertEquals(claims.surface, "studio");
  });

  it("rejects requests when verification is not configured", async () => {
    const error = await assertRejects(
      () =>
        verifyControlPlaneRequest(
          new Request("https://veryfront.test/internal/agents/stream"),
          createVerificationCtx(),
          "{}",
        ),
      ControlPlaneRequestError,
      "Control-plane verification is not configured",
    ) as ControlPlaneRequestError;

    assertEquals(error.status, 500);
  });

  it("rejects requests when the project context is unavailable", async () => {
    const ctx = {
      ...createVerificationCtx("test-key"),
      projectSlug: undefined,
    } as unknown as HandlerContext;

    const error = await assertRejects(
      () =>
        verifyControlPlaneRequest(
          new Request("https://veryfront.test/internal/agents/stream"),
          ctx,
          "{}",
        ),
      ControlPlaneRequestError,
      "Project context is unavailable",
    ) as ControlPlaneRequestError;

    assertEquals(error.status, 400);
  });

  it("rejects requests with missing control-plane signatures", async () => {
    const error = await assertRejects(
      () =>
        verifyControlPlaneRequest(
          new Request("https://veryfront.test/internal/agents/stream"),
          createVerificationCtx("test-key"),
          "{}",
        ),
      ControlPlaneRequestError,
      "Missing control-plane signature",
    ) as ControlPlaneRequestError;

    assertEquals(error.status, 401);
  });

  it("normalizes signature verification failures to unauthorized errors", async () => {
    const rawBody = JSON.stringify({ runId: "run-1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(rawBody, {
      requestId: "run-1",
      surface: "studio",
    });
    const request = new Request("https://veryfront.test/internal/agents/stream", {
      headers: { "x-veryfront-control-plane-jws": jws },
    });

    const error = await assertRejects(
      () =>
        verifyControlPlaneRequest(
          request,
          createVerificationCtx(publicKeyPem),
          `${rawBody} `,
          { expectedSubject: "run-1", expectedSurface: "studio" },
        ),
      ControlPlaneRequestError,
      "Invalid control-plane signature",
    ) as ControlPlaneRequestError;

    assertEquals(error.status, 401);
  });
});
