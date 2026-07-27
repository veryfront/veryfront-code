import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { createProxyAuthProvider } from "./auth-extension.ts";

function validProvider() {
  return {
    sign: () => Promise.resolve("token"),
    verify: () => Promise.resolve({ sub: "user" }),
    verifyWithJwks: () => Promise.resolve({ sub: "user" }),
    verifyWithPublicKey: () => Promise.resolve({ sub: "user" }),
    decode: () => ({ alg: "HS256" }),
  };
}

Deno.test("proxy auth extension boundary", async (t) => {
  await t.step("validates and freezes the first-party provider contract", async () => {
    let receivedOptions: unknown;
    const provider = createProxyAuthProvider({
      createAuthProvider: (options: unknown) => {
        receivedOptions = options;
        return validProvider();
      },
    });

    assertEquals(receivedOptions, {});
    assertEquals(Object.isFrozen(receivedOptions), true);
    assertEquals(Object.isFrozen(provider), true);
    assertEquals(await provider.sign({ sub: "user" }), "token");
    assertEquals(await provider.verify("token"), { sub: "user" });
    assertEquals(provider.decode("token"), { alg: "HS256" });
  });

  await t.step("accepts the real first-party extension module namespace", async () => {
    const extensionModule = await import(
      "../../extensions/ext-auth-jwt/src/index.ts"
    );
    const provider = createProxyAuthProvider(extensionModule);

    assertEquals(Object.isFrozen(provider), true);
    assertEquals(provider.decode("not-a-jwt"), undefined);
  });

  await t.step("rejects missing and accessor-backed module exports", () => {
    assertThrows(
      () => createProxyAuthProvider({}),
      TypeError,
      "createAuthProvider export",
    );
    let reads = 0;
    const extensionModule = Object.defineProperty(
      {},
      "createAuthProvider",
      {
        get() {
          reads++;
          return () => validProvider();
        },
      },
    );
    assertThrows(
      () => createProxyAuthProvider(extensionModule),
      TypeError,
      "own data function",
    );
    assertEquals(reads, 0);
  });

  await t.step("rejects incomplete and accessor-backed providers", () => {
    assertThrows(
      () =>
        createProxyAuthProvider({
          createAuthProvider: () => ({ sign: () => Promise.resolve("token") }),
        }),
      TypeError,
      "Proxy AuthProvider verify",
    );

    let reads = 0;
    const provider = validProvider();
    Object.defineProperty(provider, "decode", {
      configurable: true,
      get() {
        reads++;
        return () => ({ alg: "HS256" });
      },
    });
    assertThrows(
      () =>
        createProxyAuthProvider({
          createAuthProvider: () => provider,
        }),
      TypeError,
      "own data function",
    );
    assertEquals(reads, 0);
  });

  await t.step("preserves factory and provider failures", async () => {
    assertThrows(
      () =>
        createProxyAuthProvider({
          createAuthProvider: () => {
            throw new Error("factory failed");
          },
        }),
      Error,
      "factory failed",
    );
    const provider = createProxyAuthProvider({
      createAuthProvider: () => ({
        ...validProvider(),
        verify: () => Promise.reject(new Error("verification failed")),
      }),
    });
    await assertRejects(
      () => provider.verify("token"),
      Error,
      "verification failed",
    );
  });
});
