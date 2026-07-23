import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { GCSBlobStorage } from "./gcs-storage.ts";

const TEST_SERVICE_ACCOUNT_KEY = JSON.stringify({
  private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
  client_email: "test@test-project.iam.gserviceaccount.com",
});

function createAuthenticatedStorage(
  overrides: Partial<ConstructorParameters<typeof GCSBlobStorage>[0]> = {},
): GCSBlobStorage {
  const storage = new GCSBlobStorage({
    projectId: "test-project",
    bucket: "test-bucket",
    serviceAccountKey: TEST_SERVICE_ACCOUNT_KEY,
    ...overrides,
  });
  (storage as unknown as {
    tokenCache: { accessToken: string; expiresAt: Date };
  }).tokenCache = {
    accessToken: "test-token",
    expiresAt: new Date(Date.now() + 60_000),
  };
  return storage;
}

// Generate a test RSA key pair using Web Crypto API
async function generateTestServiceAccountKey(): Promise<string> {
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

  const privateKeyDer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const privateKeyBase64 = btoa(
    String.fromCharCode(...new Uint8Array(privateKeyDer)),
  );
  const pem = `-----BEGIN PRIVATE KEY-----\n${
    privateKeyBase64.match(/.{1,64}/g)!.join("\n")
  }\n-----END PRIVATE KEY-----`;

  return JSON.stringify({
    type: "service_account",
    project_id: "test-project",
    private_key: pem,
    client_email: "test@test-project.iam.gserviceaccount.com",
  });
}

Deno.test("GCSBlobStorage constructor validates serviceAccountKey JSON", () => {
  assertThrows(
    () =>
      new GCSBlobStorage({
        projectId: "test",
        bucket: "test-bucket",
        serviceAccountKey: "not-json",
      }),
    Error,
    "valid JSON string",
  );
});

Deno.test("GCSBlobStorage constructor rejects missing private_key", () => {
  assertThrows(
    () =>
      new GCSBlobStorage({
        projectId: "test",
        bucket: "test-bucket",
        serviceAccountKey: JSON.stringify({ client_email: "a@b.com" }),
      }),
    Error,
    "private_key",
  );
});

Deno.test("GCSBlobStorage constructor rejects missing client_email", () => {
  assertThrows(
    () =>
      new GCSBlobStorage({
        projectId: "test",
        bucket: "test-bucket",
        serviceAccountKey: JSON.stringify({
          private_key: "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----",
        }),
      }),
    Error,
    "client_email",
  );
});

Deno.test("GCSBlobStorage constructor accepts valid service account key", async () => {
  const key = await generateTestServiceAccountKey();
  const storage = new GCSBlobStorage({
    projectId: "test",
    bucket: "test-bucket",
    serviceAccountKey: key,
  });
  assertEquals(typeof storage, "object");
});

Deno.test("GCSBlobStorage rejects unsafe IDs on every public ID operation", async () => {
  const storage = createAuthenticatedStorage();
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            size: "0",
            contentType: "application/octet-stream",
            timeCreated: new Date().toISOString(),
          }),
          { status: 200 },
        ),
      )) as typeof fetch;

    const operations = [
      () => storage.put("data", { id: "../unsafe" }),
      () => storage.getStream("../unsafe"),
      () => storage.getText("../unsafe"),
      () => storage.getBytes("../unsafe"),
      () => storage.delete("../unsafe"),
      () => storage.exists("../unsafe"),
      () => storage.stat("../unsafe"),
    ];

    for (const operation of operations) {
      await assertRejects(operation, Error, "Invalid blob id");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("GCSBlobStorage encodes bucket and object names in API URLs", async () => {
  const storage = createAuthenticatedStorage({
    bucket: "bucket/name with space",
    prefix: "folder/?q= ",
  });
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; url: string }> = [];

  try {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      requests.push({ method, url });

      if (method === "POST") {
        return new Response(
          JSON.stringify({
            size: "4",
            contentType: "text/plain",
            timeCreated: "2025-01-01T00:00:00.000Z",
          }),
          { status: 200 },
        );
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (url.endsWith("?alt=media")) return new Response("data", { status: 200 });
      if (url.endsWith("?fields=id")) return new Response(null, { status: 200 });

      return new Response(
        JSON.stringify({
          size: "4",
          contentType: "text/plain",
          timeCreated: "2025-01-01T00:00:00.000Z",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    await storage.put("data", { id: "safe-id", mimeType: "text/plain" });
    await storage.getStream("safe-id");
    await storage.delete("safe-id");
    await storage.exists("safe-id");
    await storage.stat("safe-id");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const bucket = "bucket%2Fname%20with%20space";
  const key = "folder%2F%3Fq%3D%20safe-id";
  assertEquals(requests, [
    {
      method: "POST",
      url:
        `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${key}`,
    },
    {
      method: "GET",
      url: `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${key}?alt=media`,
    },
    {
      method: "DELETE",
      url: `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${key}`,
    },
    {
      method: "GET",
      url: `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${key}?fields=id`,
    },
    {
      method: "GET",
      url: `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${key}`,
    },
  ]);
});

Deno.test("GCSBlobStorage signs JWT with RS256 using Web Crypto", async () => {
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

  const privateKeyDer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyDer)));
  const pem = `-----BEGIN PRIVATE KEY-----\n${
    privateKeyBase64.match(/.{1,64}/g)!.join("\n")
  }\n-----END PRIVATE KEY-----`;

  const saKey = JSON.stringify({
    type: "service_account",
    project_id: "test-project",
    private_key: pem,
    client_email: "test@test-project.iam.gserviceaccount.com",
  });

  const storage = new GCSBlobStorage({
    projectId: "test-project",
    bucket: "test-bucket",
    serviceAccountKey: saKey,
  });

  // Intercept fetch to capture the JWT assertion and verify its signature
  const originalFetch = globalThis.fetch;
  let capturedJwt = "";

  try {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(init?.body as string);
        capturedJwt = body.get("assertion") ?? "";
        return new Response(
          JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
          { status: 200 },
        );
      }
      // Upload endpoint
      return new Response(
        JSON.stringify({
          size: "5",
          contentType: "text/plain",
          timeCreated: new Date().toISOString(),
          mediaLink: "https://storage.googleapis.com/test",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    await storage.put("hello", { mimeType: "text/plain" });

    // Verify the JWT structure
    const parts = capturedJwt.split(".");
    assertEquals(parts.length, 3, "JWT must have 3 parts");

    // Decode header
    const headerJson = JSON.parse(atob(parts[0]!.replace(/-/g, "+").replace(/_/g, "/")));
    assertEquals(headerJson.alg, "RS256");
    assertEquals(headerJson.typ, "JWT");

    // Decode claims
    const claimsJson = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    assertEquals(claimsJson.iss, "test@test-project.iam.gserviceaccount.com");
    assertEquals(claimsJson.aud, "https://oauth2.googleapis.com/token");
    assertEquals(typeof claimsJson.iat, "number");
    assertEquals(typeof claimsJson.exp, "number");

    // Verify signature is NOT "PLACEHOLDER_SIGNATURE"
    assertEquals(parts[2] !== "PLACEHOLDER_SIGNATURE", true, "Signature must not be a placeholder");
    assertEquals(parts[2]!.length > 20, true, "Signature must be a real RS256 signature");

    // Verify the signature with the public key
    const signatureBytes = Uint8Array.from(
      atob(parts[2]!.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      keyPair.publicKey,
      signatureBytes,
      signingInput,
    );
    assertEquals(valid, true, "JWT signature must be verifiable with the corresponding public key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
