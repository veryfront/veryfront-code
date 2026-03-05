import { assertEquals, assertThrows } from "@std/assert";
import { GCSBlobStorage } from "./gcs-storage.ts";

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
  const pem =
    `-----BEGIN PRIVATE KEY-----\n${privateKeyBase64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;

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
  const pem =
    `-----BEGIN PRIVATE KEY-----\n${privateKeyBase64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;

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

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth2.googleapis.com/token" && init?.body) {
      const body = new URLSearchParams(init.body as string);
      capturedJwt = body.get("assertion") ?? "";
      return new Response(
        JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
        { status: 200 },
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    // Trigger getAccessToken by calling put (which calls getAccessToken internally)
    // Use a mock that returns after token fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
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
    const headerJson = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
    assertEquals(headerJson.alg, "RS256");
    assertEquals(headerJson.typ, "JWT");

    // Decode claims
    const claimsJson = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    assertEquals(claimsJson.iss, "test@test-project.iam.gserviceaccount.com");
    assertEquals(claimsJson.aud, "https://oauth2.googleapis.com/token");
    assertEquals(typeof claimsJson.iat, "number");
    assertEquals(typeof claimsJson.exp, "number");

    // Verify signature is NOT "PLACEHOLDER_SIGNATURE"
    assertEquals(parts[2] !== "PLACEHOLDER_SIGNATURE", true, "Signature must not be a placeholder");
    assertEquals(parts[2].length > 20, true, "Signature must be a real RS256 signature");

    // Verify the signature with the public key
    const signatureBytes = Uint8Array.from(
      atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
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
