import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { requestAuthorityFingerprint } from "./request-authority.ts";

describe("request authority fingerprint", () => {
  it("does not expose credentials through mutable string hooks", () => {
    const token = "test-credential-\u{1F600}";
    const expected = requestAuthorityFingerprint(token);
    const iterator = String.prototype[Symbol.iterator];
    const codePointAt = String.prototype.codePointAt;
    let calls = 0;
    let actual: string;
    String.prototype[Symbol.iterator] = function () {
      calls++;
      return Reflect.apply(iterator, this, []);
    };
    String.prototype.codePointAt = function (position) {
      calls++;
      return Reflect.apply(codePointAt, this, [position]);
    };
    try {
      actual = requestAuthorityFingerprint(token);
    } finally {
      String.prototype[Symbol.iterator] = iterator;
      String.prototype.codePointAt = codePointAt;
    }
    assertEquals(actual, expected);
    assertEquals(calls, 0);
  });
});
