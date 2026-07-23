import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createHostedServiceAuth,
  getHostedServiceTokenFromRequest,
  HostedServiceAuthError,
  type HostedServiceAuthFetch,
  type HostedServiceJwtVerifier,
} from "./auth.ts";

type JwtFixture = {
  token: string;
  publicKeyPem: string;
};

type FetchCall = {
  input: string | URL | Request;
  init: RequestInit | undefined;
};

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return encodeBase64UrlBytes(bytes);
}

function encodeBase64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64UrlBytes(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const binary = atob(`${normalized}${"=".repeat(paddingLength)}`);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeJsonBase64Url(value: Record<string, unknown>): string {
  return encodeBase64Url(JSON.stringify(value));
}

function spkiDerToPem(der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function pemToSpkiDer(publicKeyPem: string): Uint8Array<ArrayBuffer> {
  const base64 = publicKeyPem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  return decodeBase64UrlBytes(base64.replace(/\+/g, "-").replace(/\//g, "_"));
}

function createUnsignedJwt(payload: Record<string, unknown>): string {
  return [
    encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
    encodeBase64Url(JSON.stringify(payload)),
    "signature",
  ].join(".");
}

async function createRs256JwtFixture(
  payload: Record<string, unknown>,
): Promise<JwtFixture> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: issuedAt, exp: issuedAt + 3600 };
  const signingInput = [
    encodeJsonBase64Url({ alg: "RS256", typ: "JWT" }),
    encodeJsonBase64Url(claims),
  ].join(".");
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  const publicKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);

  return {
    token: `${signingInput}.${encodeBase64UrlBytes(new Uint8Array(signature))}`,
    publicKeyPem: spkiDerToPem(publicKeyDer),
  };
}

const webCryptoAuthProvider: HostedServiceJwtVerifier = {
  async verifyWithPublicKey(token, publicKeyPem) {
    const [headerPart, payloadPart, signaturePart] = token.split(".");
    if (!headerPart || !payloadPart || !signaturePart) {
      throw new Error("Invalid token");
    }
    const header = JSON.parse(new TextDecoder().decode(decodeBase64UrlBytes(headerPart)));
    if (header?.alg !== "RS256") {
      throw new Error("Invalid token");
    }
    const publicKey = await crypto.subtle.importKey(
      "spki",
      pemToSpkiDer(publicKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signingInput = `${headerPart}.${payloadPart}`;
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      decodeBase64UrlBytes(signaturePart),
      new TextEncoder().encode(signingInput),
    );
    if (!valid) {
      throw new Error("Invalid token");
    }
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64UrlBytes(payloadPart)));
    if (typeof payload?.exp === "number" && payload.exp * 1000 < Date.now()) {
      throw new Error("expired");
    }
    return payload;
  },
};

function createFetchMock(response: Response): {
  calls: FetchCall[];
  fetch: HostedServiceAuthFetch;
} {
  const calls: FetchCall[] = [];
  const fetchMock: HostedServiceAuthFetch = (input, init) => {
    calls.push({ input, init });
    return Promise.resolve(response.clone());
  };

  return { calls, fetch: fetchMock };
}

function getAuthorizationHeader(call: FetchCall): string | null {
  const headers = call.init?.headers;
  if (headers instanceof Headers) return headers.get("authorization");
  return null;
}

function getOnlyFetchCall(calls: FetchCall[]): FetchCall {
  assertEquals(calls.length, 1);
  const call = calls[0];
  if (!call) throw new Error("Expected one fetch call");
  return call;
}

describe("agent/agent-service-auth", () => {
  it("creates typed agent service auth errors", () => {
    const unauthenticated = new HostedServiceAuthError(401, "Token required");
    assertEquals(unauthenticated.name, "HostedServiceAuthError");
    assertEquals(unauthenticated.statusCode, 401);
    assertEquals(unauthenticated.errorCode, "UNAUTHENTICATED");
    assertEquals(unauthenticated.message, "Token required");

    const forbidden = new HostedServiceAuthError(403, "No access");
    assertEquals(forbidden.statusCode, 403);
    assertEquals(forbidden.errorCode, "FORBIDDEN");

    assertEquals(new HostedServiceAuthError(404, "Missing").errorCode, "NOT_FOUND");
    assertEquals(new HostedServiceAuthError(500, "Broken").errorCode, "SERVER_ERROR");
  });

  it("extracts auth tokens from cookies before bearer headers", () => {
    const request = new Request("https://agent.test/run", {
      headers: {
        authorization: "Bearer bearer-token",
        cookie: "theme=dark; authToken=cookie-token; other=value",
      },
    });

    assertEquals(getHostedServiceTokenFromRequest(request), "cookie-token");
  });

  it("extracts bearer auth tokens when no auth cookie exists", () => {
    const request = new Request("https://agent.test/run", {
      headers: { authorization: "Bearer bearer-token" },
    });

    assertEquals(getHostedServiceTokenFromRequest(request), "bearer-token");
  });

  it("accepts case-insensitive bearer schemes and horizontal whitespace", () => {
    const request = new Request("https://agent.test/run", {
      headers: { authorization: "bearer\tcase-insensitive-token" },
    });

    assertEquals(getHostedServiceTokenFromRequest(request), "case-insensitive-token");
  });

  it("returns null when no auth token exists", () => {
    const request = new Request("https://agent.test/run");
    assertStrictEquals(getHostedServiceTokenFromRequest(request), null);
  });

  it("verifies RS256 JWTs with configured public key", async () => {
    const fixture = await createRs256JwtFixture({
      userId: "user-1",
      email: "user@example.test",
    });
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(fixture.token);

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected JWT verification to succeed");
    assertEquals(result.userId, "user-1");
    assertEquals(result.email, "user@example.test");
    assertEquals(result.token, fixture.token);
  });

  it("uses the built-in AuthProvider for configured public key JWTs", async () => {
    const fixture = await createRs256JwtFixture({
      userId: "user-1",
      email: "user@example.test",
    });
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(fixture.token);

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected JWT verification to succeed");
    assertEquals(result.userId, "user-1");
    assertEquals(result.email, "user@example.test");
  });

  it("uses an AuthProvider to verify configured public key JWTs", async () => {
    const calls: Array<{
      token: string;
      publicKeyPem: string;
      options: { algorithms?: string[] } | undefined;
    }> = [];
    const auth = createHostedServiceAuth({
      authProvider: {
        verifyWithPublicKey(token, publicKeyPem, options) {
          calls.push({ token, publicKeyPem, options });
          return Promise.resolve({
            sub: "user-1",
            userId: "user-1",
            email: "user@example.test",
          });
        },
      },
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: "public-key",
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt("signed-token");

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected JWT verification to succeed");
    assertEquals(result.userId, "user-1");
    assertEquals(result.email, "user@example.test");
    assertEquals(calls, [
      {
        token: "signed-token",
        publicKeyPem: "public-key",
        options: { algorithms: ["RS256"] },
      },
    ]);
  });

  it("returns empty email when a valid JWT has no email claim", async () => {
    const fixture = await createRs256JwtFixture({ userId: "user-1" });
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(fixture.token);

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected JWT verification to succeed");
    assertEquals(result.email, "");
  });

  it("rejects JWTs without a userId", async () => {
    const fixture = await createRs256JwtFixture({ email: "user@example.test" });
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(fixture.token);

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected JWT verification to fail");
    assertEquals(result.error.statusCode, 401);
    assertEquals(result.error.errorCode, "UNAUTHENTICATED");
    assertEquals(result.error.message, "Invalid token: missing userId");
  });

  it("requires a public key in production", async () => {
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt("token");

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected JWT verification to fail");
    assertEquals(result.error.statusCode, 500);
    assertEquals(result.error.errorCode, "SERVER_ERROR");
    assertEquals(result.error.message, "JWT public key not configured");
  });

  it("decodes unsigned JWTs outside production when no public key is configured", async () => {
    const token = createUnsignedJwt({
      userId: "user-åäö",
      email: "åäö@example.test",
    });
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        NODE_ENV: "development",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(token);

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected development JWT decode to succeed");
    assertEquals(result.userId, "user-åäö");
    assertEquals(result.email, "åäö@example.test");
  });

  it("rejects expired unsigned JWTs", async () => {
    const token = createUnsignedJwt({ userId: "user-1", exp: 1 });
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        NODE_ENV: "development",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt(token);

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected development JWT decode to fail");
    assertEquals(result.error.message, "Token expired");
  });

  it("rejects malformed unsigned JWTs", async () => {
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        NODE_ENV: "development",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyJwt("not-a-token");

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected development JWT decode to fail");
    assertEquals(result.error.message, "Invalid token format");
  });

  it("authenticates requests into agent service auth context", async () => {
    const fixture = await createRs256JwtFixture({ userId: "user-1" });
    const request = new Request("https://agent.test/api/ag-ui", {
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    const auth = createHostedServiceAuth({
      authProvider: webCryptoAuthProvider,
      getConfig: () => ({
        OAUTH_PUBLIC_KEY: fixture.publicKeyPem,
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.authenticateRequest(request);

    assert(!(result instanceof Response));
    assertEquals(result, { authToken: fixture.token, userId: "user-1" });
  });

  it("returns 401 JSON responses for unauthenticated requests", async () => {
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.authenticateRequest(
      new Request("https://agent.test/api/ag-ui"),
    );

    assertInstanceOf(result, Response);
    assertEquals(result.status, 401);
    assertEquals(await result.json(), { errorCode: "UNAUTHENTICATED" });
  });

  it("preserves server error status when authentication is misconfigured", async () => {
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.authenticateRequest(
      new Request("https://agent.test/api/ag-ui", {
        headers: { authorization: "Bearer token" },
      }),
    );

    assertInstanceOf(result, Response);
    assertEquals(result.status, 500);
    assertEquals(await result.json(), { errorCode: "SERVER_ERROR" });
  });

  it("checks project access against the configured API origin", async () => {
    const fetchMock = createFetchMock(new Response("{}", { status: 200 }));
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      projectAccessTimeoutMs: 1_000,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test/v1",
      }),
    });

    const result = await auth.verifyProjectAccess("project-1", "token-1");

    assertEquals(result.success, true);
    if (!result.success) throw new Error("Expected project access to succeed");
    assertEquals(result.projectId, "project-1");
    const call = getOnlyFetchCall(fetchMock.calls);
    assertEquals(String(call.input), "https://api.example.test/projects/project-1");
    assertEquals(call.init?.method, "GET");
    assertEquals(getAuthorizationHeader(call), "Bearer token-1");
  });

  it("encodes project identifiers as one URL path segment", async () => {
    const fetchMock = createFetchMock(new Response("{}", { status: 200 }));
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    await auth.verifyProjectAccess("project/with#delimiters", "token-1");

    assertEquals(
      String(getOnlyFetchCall(fetchMock.calls).input),
      "https://api.example.test/projects/project%2Fwith%23delimiters",
    );
  });

  it("rejects invalid project access timeouts at construction", () => {
    assertThrows(
      () =>
        createHostedServiceAuth({
          projectAccessTimeoutMs: 0,
          getConfig: () => ({
            NODE_ENV: "production",
            VERYFRONT_API_URL: "https://api.example.test",
          }),
        }),
      Error,
      "projectAccessTimeoutMs must be a positive safe integer",
    );
  });

  it("omits authorization on project access checks without a token", async () => {
    const fetchMock = createFetchMock(new Response("{}", { status: 200 }));
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    await auth.verifyProjectAccess("project-1", "");

    assertEquals(getAuthorizationHeader(getOnlyFetchCall(fetchMock.calls)), null);
  });

  it("maps missing projects to NOT_FOUND", async () => {
    const fetchMock = createFetchMock(new Response("Not found", { status: 404 }));
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyProjectAccess("project-1", "token-1");

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected project access to fail");
    assertEquals(result.error.statusCode, 404);
    assertEquals(result.error.errorCode, "NOT_FOUND");
  });

  it("maps unauthorized project responses to FORBIDDEN", async () => {
    const fetchMock = createFetchMock(new Response("Forbidden", { status: 403 }));
    const auth = createHostedServiceAuth({
      fetch: fetchMock.fetch,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyProjectAccess("project-1", "token-1");

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected project access to fail");
    assertEquals(result.error.statusCode, 403);
    assertEquals(result.error.errorCode, "FORBIDDEN");
  });

  it("maps failed project access fetches to FORBIDDEN", async () => {
    const fetchMock: HostedServiceAuthFetch = () => Promise.reject(new Error("boom"));
    const auth = createHostedServiceAuth({
      fetch: fetchMock,
      getConfig: () => ({
        NODE_ENV: "production",
        VERYFRONT_API_URL: "https://api.example.test",
      }),
    });

    const result = await auth.verifyProjectAccess("project-1", "token-1");

    assertEquals(result.success, false);
    if (result.success) throw new Error("Expected project access to fail");
    assertEquals(result.error.statusCode, 403);
    assertEquals(result.error.errorCode, "FORBIDDEN");
  });
});
