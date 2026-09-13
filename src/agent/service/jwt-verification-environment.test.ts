import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { isSafeHostedJwtVerificationEnvironment } from "./jwt-verification-environment.ts";

it("checks owned prototype chains without invoking then accessors", () => {
  assertEquals(isSafeHostedJwtVerificationEnvironment(), true);
  assertEquals(isSafeHostedJwtVerificationEnvironment(Object.create(null)), true);
  let reads = 0;
  const inherited = Object.create(null);
  Object.defineProperty(inherited, "then", {
    get() {
      reads++;
      return () => {};
    },
  });
  assertEquals(isSafeHostedJwtVerificationEnvironment(Object.create(inherited)), false);
  assertEquals(isSafeHostedJwtVerificationEnvironment({ then: undefined }), false);
  assertEquals(isSafeHostedJwtVerificationEnvironment("not-an-object"), false);
  assertEquals(reads, 0);
});

it("rejects uninspectable and excessive prototype chains", () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assertEquals(isSafeHostedJwtVerificationEnvironment(revoked.proxy), false);
  let value = Object.create(null);
  for (let index = 0; index < 130; index++) value = Object.create(value);
  assertEquals(isSafeHostedJwtVerificationEnvironment(value), false);
});
