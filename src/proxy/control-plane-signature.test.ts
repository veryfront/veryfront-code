import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import {
  ControlPlaneBranchBindingError,
  isAuthenticInternalControlPlaneCandidate,
  isVerifiedInternalControlPlaneRequest,
  resolveVerifiedControlPlaneBranchBinding,
} from "./control-plane-signature.ts";

const PUBLIC_KEY_ENV = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const CONTROL_PLANE_PATH =
  "http://protected.preview.veryfront.com/api/control-plane/runs/r_1/stream";
const encoder = new TextEncoder();

function base64url(data: string): string {
  return btoa(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlBytes(bytes: Uint8Array): string {
  return base64url(String.fromCharCode(...bytes));
}

async function sha256Base64url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64urlBytes(new Uint8Array(digest));
}

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

type JwsKind = "dispatch" | "control-plane";

async function mintJws(
  kind: JwsKind,
  overrides: Partial<{
    iss: string;
    aud: string;
    projectId: string;
    iat: number;
    exp: number;
    alg: string;
    requestMethod: string;
    requestPath: string;
    body: string;
    signingKeyPair: CryptoKeyPair;
    advertisedKeyPair: CryptoKeyPair;
  }> = {},
): Promise<{ jws: string; publicKeyPem: string }> {
  const signingKeyPair = overrides.signingKeyPair ??
    (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair);
  const advertisedKeyPair = overrides.advertisedKeyPair ?? signingKeyPair;

  const der = await crypto.subtle.exportKey("spki", advertisedKeyPair.publicKey);
  const publicKeyPem = encodePem("PUBLIC KEY", der);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: overrides.alg ?? "EdDSA", typ: "JWT" };
  const base = {
    iss: overrides.iss ?? "veryfront-api",
    aud: overrides.aud ?? "protected",
    sub: "control-plane",
    project_id: overrides.projectId ?? "proj-1",
    iat: overrides.iat ?? now,
    exp: overrides.exp ?? now + 60,
  };
  const claims = kind === "dispatch" ? { ...base, platform: "slack", body_sha256: "n/a" } : {
    ...base,
    surface: "channels",
    request_hash: await sha256Base64url(overrides.body ?? ""),
    request_method: overrides.requestMethod ?? "POST",
    request_path: overrides.requestPath ??
      "/api/control-plane/runs/r_1/stream",
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(claims));
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign("Ed25519", signingKeyPair.privateKey, signingInput);

  return {
    publicKeyPem,
    jws: `${encodedHeader}.${encodedPayload}.${base64urlBytes(new Uint8Array(signature))}`,
  };
}

function requestWith(
  headers: Record<string, string>,
  url = CONTROL_PLANE_PATH,
  method = "POST",
  body?: string,
): {
  req: Request;
  url: URL;
} {
  return { req: new Request(url, { method, headers, body }), url: new URL(url) };
}

function createNestedTargetBody(
  project: Record<string, unknown>,
  agentSource: Record<string, unknown>,
): string {
  return JSON.stringify({ run: { project }, agentSource });
}

async function resolveNestedTarget(body: string) {
  const { jws, publicKeyPem } = await mintJws("control-plane", { body });
  Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
  const { req, url } = requestWith(
    { "x-token": "t", "x-veryfront-control-plane-jws": jws },
    CONTROL_PLANE_PATH,
    "POST",
    body,
  );
  return await resolveVerifiedControlPlaneBranchBinding(req, url, {
    audience: "protected",
    expectedProjectId: "proj-1",
  });
}

function verifyRequest(
  req: Request,
  url: URL,
  binding: { audience: string; expectedProjectId?: string } = {
    audience: "protected",
    expectedProjectId: "proj-1",
  },
): Promise<boolean> {
  return isVerifiedInternalControlPlaneRequest(req, url, binding);
}

describe("proxy/control-plane-signature", () => {
  let previousKey: string | undefined;

  beforeEach(() => {
    previousKey = Deno.env.get(PUBLIC_KEY_ENV);
    Deno.env.delete(PUBLIC_KEY_ENV);
  });

  afterEach(() => {
    if (previousKey === undefined) Deno.env.delete(PUBLIC_KEY_ENV);
    else Deno.env.set(PUBLIC_KEY_ENV, previousKey);
  });

  it("defaults an omitted nested runtime target kind to the main branch", async () => {
    assertEquals(
      await resolveNestedTarget(
        createNestedTargetBody({}, { type: "branch", branch: "trunk" }),
      ),
      { defaultBranchName: "trunk" },
    );
  });

  it("validates nested environment target identity", async () => {
    assertEquals(
      await resolveNestedTarget(
        createNestedTargetBody(
          {
            runtimeTargetKind: "environment",
            runtimeTargetEnvironmentId: "10000000-1000-4000-8000-100000000006",
          },
          { type: "environment", environmentName: "preview", releaseId: "release-1" },
        ),
      ),
      {},
    );
  });

  it("rejects mismatched nested runtime targets", async () => {
    const cases = [
      createNestedTargetBody(
        {
          runtimeTargetKind: "preview_branch",
          runtimeTargetBranchId: "10000000-1000-4000-8000-100000000006",
          runtimeTargetEnvironmentId: "10000000-1000-4000-8000-100000000007",
        },
        { type: "branch", branch: "feature" },
      ),
      createNestedTargetBody(
        { runtimeTargetKind: "environment" },
        { type: "environment", environmentName: "preview", releaseId: "release-1" },
      ),
      createNestedTargetBody(
        { runtimeTargetEnvironmentId: "10000000-1000-4000-8000-100000000006" },
        { type: "branch", branch: "trunk" },
      ),
      createNestedTargetBody(
        {
          runtimeTargetKind: "preview_branch",
          runtimeTargetBranchId: "10000000-1000-4000-8000-100000000006",
        },
        { type: "release", releaseId: "release-1" },
      ),
    ];

    for (const body of cases) {
      await assertRejects(
        () => resolveNestedTarget(body),
        ControlPlaneBranchBindingError,
      );
    }
  });

  it("returns false for non-control-plane paths", async () => {
    const { jws, publicKeyPem } = await mintJws("dispatch");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith(
      { "x-token": "t", "x-veryfront-dispatch-jws": jws },
      "http://protected.preview.veryfront.com/some/page",
    );
    assertEquals(await verifyRequest(req, url), false);
  });

  it("returns false when x-token is missing", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-veryfront-control-plane-jws": jws });
    assertEquals(await verifyRequest(req, url), false);
  });

  it("returns false when the verification key is not configured", async () => {
    const { jws } = await mintJws("control-plane");
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await verifyRequest(req, url), false);
  });

  it("returns false when only a presence-only (non-JWS) header is set", async () => {
    const { publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({
      "x-token": "t",
      "x-veryfront-control-plane-jws": "signed-request",
    });
    assertEquals(await verifyRequest(req, url), false);
  });

  it("returns true for a valid, fresh dispatch JWS on /channels/invoke", async () => {
    const { jws, publicKeyPem } = await mintJws("dispatch");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith(
      { "x-token": "t", "x-veryfront-dispatch-jws": jws },
      "http://protected.preview.veryfront.com/channels/invoke",
    );
    assertEquals(await verifyRequest(req, url), true);
  });

  it("does not accept a dispatch JWS on a control-plane route", async () => {
    const { jws, publicKeyPem } = await mintJws("dispatch");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({
      "x-token": "t",
      "x-veryfront-dispatch-jws": jws,
    });
    assertEquals(await verifyRequest(req, url), false);
  });

  it("returns true for a valid, fresh control-plane JWS", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await verifyRequest(req, url), true);
  });

  it("authenticates a custom-domain candidate without granting project binding", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith(
      { "x-token": "t", "x-veryfront-control-plane-jws": jws },
      "https://custom.example.test/api/control-plane/runs/r_1/stream",
    );

    assertEquals(await isAuthenticInternalControlPlaneCandidate(req, url), true);
    assertEquals(await verifyRequest(req, url, { audience: "another-project" }), false);
  });

  it("binds authentic signatures to the resolved project audience and id", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({
      "x-token": "t",
      "x-veryfront-control-plane-jws": jws,
    });

    assertEquals(await verifyRequest(req, url, { audience: "other" }), false);
    assertEquals(
      await verifyRequest(req, url, {
        audience: "protected",
        expectedProjectId: "other-project",
      }),
      false,
    );
  });

  it("trusts only method/path pairs with guaranteed downstream verification", async () => {
    for (
      const [method, path] of [
        ["POST", "/api/control-plane/agents/list"],
        ["POST", "/api/control-plane/runs/r_1/execute"],
        ["POST", "/api/control-plane/runs/r_1/stream"],
        ["POST", "/api/control-plane/runs/r_1/resume"],
        ["DELETE", "/api/control-plane/runs/r_1"],
      ] as const
    ) {
      const { jws, publicKeyPem } = await mintJws("control-plane", {
        requestMethod: method,
        requestPath: path,
      });
      Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
      const headers = { "x-token": "t", "x-veryfront-control-plane-jws": jws };
      const { req, url } = requestWith(headers, `http://protected.test${path}`, method);
      assertEquals(await verifyRequest(req, url), true, `${method} ${path}`);
    }

    const { jws, publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const headers = { "x-token": "t", "x-veryfront-control-plane-jws": jws };

    for (
      const [method, path] of [
        ["GET", "/api/control-plane/runs/r_1/stream"],
        ["POST", "/api/control-plane/runs/r_1"],
        ["DELETE", "/api/control-plane/runs/r_1/extra"],
        ["POST", "/api/control-plane/application-route"],
        ["POST", "/internal/tasks/application-route"],
        ["POST", "/internal/workflows/application-route"],
      ] as const
    ) {
      const { req, url } = requestWith(headers, `http://protected.test${path}`, method);
      assertEquals(await verifyRequest(req, url), false, `${method} ${path}`);
    }
  });

  it("rejects replay across control-plane methods and operation paths", async () => {
    const resumePath = "/api/control-plane/runs/r_1/resume";
    const { jws, publicKeyPem } = await mintJws("control-plane", {
      requestMethod: "POST",
      requestPath: resumePath,
    });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const headers = { "x-token": "t", "x-veryfront-control-plane-jws": jws };

    const resume = requestWith(headers, `http://protected.test${resumePath}`, "POST");
    assertEquals(await verifyRequest(resume.req, resume.url), true);

    const cancel = requestWith(
      headers,
      "http://protected.test/api/control-plane/runs/r_1",
      "DELETE",
    );
    assertEquals(await verifyRequest(cancel.req, cancel.url), false);

    const otherRun = requestWith(
      headers,
      "http://protected.test/api/control-plane/runs/r_2/resume",
      "POST",
    );
    assertEquals(await verifyRequest(otherRun.req, otherRun.url), false);
  });

  it("uses canonical URL pathname while excluding origin and query", async () => {
    const canonicalPath = "/api/control-plane/runs/r_1/resume";
    const { jws, publicKeyPem } = await mintJws("control-plane", {
      requestMethod: "POST",
      requestPath: canonicalPath,
    });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const headers = { "x-token": "t", "x-veryfront-control-plane-jws": jws };
    const canonicalized = requestWith(
      headers,
      "https://another-origin.test/api/control-plane/runs/r_1/./resume?trace=ignored",
      "POST",
    );

    assertEquals(canonicalized.url.pathname, canonicalPath);
    assertEquals(await verifyRequest(canonicalized.req, canonicalized.url), true);

    const rawDotPath = await mintJws("control-plane", {
      requestMethod: "POST",
      requestPath: "/api/control-plane/runs/r_1/./resume",
    });
    Deno.env.set(PUBLIC_KEY_ENV, rawDotPath.publicKeyPem);
    const nonCanonical = requestWith(
      { "x-token": "t", "x-veryfront-control-plane-jws": rawDotPath.jws },
      `https://another-origin.test${canonicalPath}`,
      "POST",
    );
    assertEquals(await verifyRequest(nonCanonical.req, nonCanonical.url), false);
  });

  it("does not accept a control-plane JWS on /channels/invoke", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith(
      { "x-token": "t", "x-veryfront-control-plane-jws": jws },
      "http://protected.preview.veryfront.com/channels/invoke",
    );
    assertEquals(await verifyRequest(req, url), false);
  });

  it("returns false for a signature minted by a different key", async () => {
    const signingKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]) as CryptoKeyPair;
    const advertisedKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]) as CryptoKeyPair;
    const { jws, publicKeyPem } = await mintJws("control-plane", {
      signingKeyPair,
      advertisedKeyPair,
    });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await verifyRequest(req, url), false);
  });

  it("returns false for an unexpected issuer", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane", { iss: "evil" });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await verifyRequest(req, url), false);
  });

  it("returns false for an expired signature", async () => {
    const now = Math.floor(Date.now() / 1000);
    const { jws, publicKeyPem } = await mintJws("control-plane", {
      iat: now - 120,
      exp: now - 60,
    });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await verifyRequest(req, url), false);
  });

  it("returns false for a stale (too old) but unexpired signature", async () => {
    const now = Math.floor(Date.now() / 1000);
    const { jws, publicKeyPem } = await mintJws("control-plane", {
      iat: now - 300,
      exp: now + 300,
    });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await verifyRequest(req, url), false);
  });

  it("returns false for a non-EdDSA algorithm header", async () => {
    const { jws, publicKeyPem } = await mintJws("control-plane", { alg: "HS256" });
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({ "x-token": "t", "x-veryfront-control-plane-jws": jws });
    assertEquals(await verifyRequest(req, url), false);
  });

  it("returns false for a malformed JWS", async () => {
    const { publicKeyPem } = await mintJws("control-plane");
    Deno.env.set(PUBLIC_KEY_ENV, publicKeyPem);
    const { req, url } = requestWith({
      "x-token": "t",
      "x-veryfront-control-plane-jws": "not.a.jws",
    });
    assertEquals(await verifyRequest(req, url), false);
  });
});
