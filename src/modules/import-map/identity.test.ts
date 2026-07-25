import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertImportMapIdentity, createImportMapIdentity } from "./identity.ts";

describe("modules/import-map/identity", () => {
  it("keeps the pair immutable and its private brand unforgeable after primordial poisoning", async () => {
    const originalFreeze = Object.freeze;
    const originalTypeError = TypeError;
    const originalWeakSetAdd = WeakSet.prototype.add;
    const originalWeakSetHas = WeakSet.prototype.has;
    let identity: Awaited<ReturnType<typeof createImportMapIdentity>> | undefined;
    let validIdentityRejected = false;
    let forgedIdentityAccepted = false;
    let forgedIdentityError: unknown;

    try {
      Reflect.set(Object, "freeze", <T>(value: T): T => value);
      Reflect.set(
        globalThis,
        "TypeError",
        class PoisonedTypeError extends Error {},
      );
      Reflect.set(WeakSet.prototype, "add", () => {
        throw new Error("poisoned WeakSet.prototype.add");
      });
      Reflect.set(WeakSet.prototype, "has", () => true);

      identity = await createImportMapIdentity({
        imports: { package: "https://example.com/package.ts" },
      });
      try {
        assertImportMapIdentity(identity);
      } catch (_) {
        validIdentityRejected = true;
      }
      try {
        assertImportMapIdentity({
          importMap: identity.importMap,
          fingerprint: identity.fingerprint,
        });
        forgedIdentityAccepted = true;
      } catch (error) {
        forgedIdentityError = error;
      }
    } finally {
      Reflect.set(Object, "freeze", originalFreeze);
      Reflect.set(globalThis, "TypeError", originalTypeError);
      Reflect.set(WeakSet.prototype, "add", originalWeakSetAdd);
      Reflect.set(WeakSet.prototype, "has", originalWeakSetHas);
    }

    assertEquals(validIdentityRejected, false);
    assertEquals(forgedIdentityAccepted, false);
    assertEquals(forgedIdentityError instanceof originalTypeError, true);
    assertEquals(Object.isFrozen(identity), true);
    assertEquals(Object.isFrozen(identity?.importMap), true);
    assertEquals(Object.isFrozen(identity?.importMap.imports), true);
    assertEquals(identity?.importMap.imports?.package, "https://example.com/package.ts");
    assertEquals(identity?.fingerprint.length, 64);
  });
});
