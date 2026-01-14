import { assertEquals, assertExists } from "jsr:@std/assert@1";
import type { AuthMethod } from "./login.ts";

Deno.test("AuthMethod type includes google, github, microsoft, and token", () => {
  const validMethods: AuthMethod[] = ["google", "github", "microsoft", "token"];
  assertExists(validMethods);
  assertEquals(validMethods.length, 4);
  assertEquals(validMethods.includes("google"), true);
  assertEquals(validMethods.includes("github"), true);
  assertEquals(validMethods.includes("microsoft"), true);
  assertEquals(validMethods.includes("token"), true);
});

Deno.test("validateToken returns user info for valid token", async () => {
  const originalFetch = globalThis.fetch;
  const mockUser = { id: "1", email: "test@test.com", name: "Test" };

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(mockUser), { status: 200 });
  }) as typeof fetch;

  try {
    const { validateToken } = await import("./login.ts");
    const result = await validateToken("test-token");
    assertEquals(result, mockUser);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("validateToken returns null for invalid token", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return new Response("Unauthorized", { status: 401 });
  }) as typeof fetch;

  try {
    const { validateToken } = await import("./login.ts");
    const result = await validateToken("invalid-token");
    assertEquals(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
