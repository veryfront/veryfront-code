import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import {
  createControlPlaneSignature,
  createCtx as createVerificationCtx,
} from "../server/handlers/request/internal-agent-run.test-helpers.ts";
import {
  consumeVerifiedControlPlaneCacheCredential,
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
  const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";

  it("prefers adapter-provided verification keys", () => {
    const originalValue = Deno.env.get(envKey);
    Deno.env.set(envKey, "host-key");

    try {
      const ctx = createCtx((key) =>
        key === "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY" ? "adapter-key" : undefined
      );
      assertEquals(getControlPlaneVerificationPublicKey(ctx), "adapter-key");
    } finally {
      if (originalValue === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, originalValue);
    }
  });

  it("falls back to the host key when adapter context hides it", () => {
    const originalValue = Deno.env.get(envKey);
    Deno.env.set(envKey, "host-key");

    try {
      assertEquals(
        getControlPlaneVerificationPublicKey(createCtx(() => undefined)),
        "host-key",
      );
    } finally {
      if (originalValue === undefined) {
        Deno.env.delete(envKey);
      } else {
        Deno.env.set(envKey, originalValue);
      }
    }
  });

  it("verifies signed control-plane requests", async () => {
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const originalSigningKey = Deno.env.get(envKey);
    Deno.env.delete("VERYFRONT_API_TOKEN");
    const rawBody = JSON.stringify({
      runId: "run-1",
      credentials: { authToken: "signed-body-token" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(rawBody, {
      requestId: "run-1",
      surface: "studio",
    });
    const request = new Request("https://veryfront.test/api/control-plane/runs/run_1/stream", {
      headers: { "x-veryfront-control-plane-jws": jws },
    });
    Deno.env.set(envKey, publicKeyPem);

    try {
      const claims = await verifyControlPlaneRequest(
        request,
        createVerificationCtx(publicKeyPem),
        rawBody,
        { expectedSubject: "run-1", expectedSurface: "studio" },
      );

      assertEquals(claims.sub, "run-1");
      assertEquals(claims.surface, "studio");
      assertEquals(consumeVerifiedControlPlaneCacheCredential(claims), {
        token: "signed-body-token",
        projectId: "proj-1",
        projectSlug: "demo-project",
      });
      assertEquals(
        consumeVerifiedControlPlaneCacheCredential({ ...claims } as typeof claims),
        null,
      );
      assertEquals(consumeVerifiedControlPlaneCacheCredential(claims), null);
    } finally {
      if (originalApiToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
      else Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
      if (originalSigningKey === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, originalSigningKey);
    }
  });

  it("does not mint a host override from an adapter-only verification key", async () => {
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const originalSigningKey = Deno.env.get(envKey);
    Deno.env.set("VERYFRONT_API_TOKEN", "host-framework-token");
    const rawBody = JSON.stringify({
      runId: "run-1",
      credentials: { authToken: "adapter-context-token" },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(rawBody, {
      requestId: "run-1",
      surface: "studio",
    });
    const { publicKeyPem: hostPublicKeyPem } = await createControlPlaneSignature("{}");
    Deno.env.set(envKey, hostPublicKeyPem);

    try {
      const claims = await verifyControlPlaneRequest(
        new Request("https://veryfront.test/api/control-plane/runs/run_1/stream", {
          headers: { "x-veryfront-control-plane-jws": jws },
        }),
        createVerificationCtx(publicKeyPem),
        rawBody,
        { expectedSubject: "run-1", expectedSurface: "studio" },
      );

      assertEquals(consumeVerifiedControlPlaneCacheCredential(claims), null);
    } finally {
      if (originalApiToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
      else Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
      if (originalSigningKey === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, originalSigningKey);
    }
  });

  it("rejects requests when verification is not configured", async () => {
    const originalValue = Deno.env.get(envKey);
    Deno.env.delete(envKey);

    try {
      const error = await assertRejects(
        () =>
          verifyControlPlaneRequest(
            new Request("https://veryfront.test/api/control-plane/runs/run_1/stream"),
            createVerificationCtx(),
            "{}",
          ),
        ControlPlaneRequestError,
        "Control-plane verification is not configured",
      ) as ControlPlaneRequestError;

      assertEquals(error.status, 500);
    } finally {
      if (originalValue === undefined) {
        Deno.env.delete(envKey);
      } else {
        Deno.env.set(envKey, originalValue);
      }
    }
  });

  it("rejects requests when the project context is unavailable", async () => {
    const ctx = {
      ...createVerificationCtx("test-key"),
      projectSlug: undefined,
    } as unknown as HandlerContext;

    const error = await assertRejects(
      () =>
        verifyControlPlaneRequest(
          new Request("https://veryfront.test/api/control-plane/runs/run_1/stream"),
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
          new Request("https://veryfront.test/api/control-plane/runs/run_1/stream"),
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
    const request = new Request("https://veryfront.test/api/control-plane/runs/run_1/stream", {
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
