import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { register, reset, resolve, tryResolve } from "../extensions/contracts.ts";
import { createAuthProvider } from "../../extensions/ext-auth-jwt/src/index.ts";
import type { AuthProvider } from "../extensions/auth/index.ts";

describe("Proxy AuthProvider contract registration", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("ext-auth-jwt registers a valid AuthProvider", () => {
    reset();
    const provider = createAuthProvider({});
    register("AuthProvider", provider);

    const resolved = tryResolve<AuthProvider>("AuthProvider");
    assertNotEquals(resolved, undefined);
    assertEquals(typeof resolved!.verify, "function");
    assertEquals(typeof resolved!.sign, "function");
    assertEquals(typeof resolved!.decode, "function");
    assertEquals(typeof resolved!.verifyWithJwks, "function");
    reset();
  });

  it("resolve throws when AuthProvider is not registered", () => {
    reset();
    let threw = false;
    try {
      resolve<AuthProvider>("AuthProvider");
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
    reset();
  });
});
