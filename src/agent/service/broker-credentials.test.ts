import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { containsBrokerCredential } from "./broker-credentials.ts";

describe("broker credential text normalization", () => {
  for (
    const [name, value] of [
      ["malformed escape prefix", "%ZZ api%2Dauth%2Dtoken"],
      ["invalid UTF-8 prefix", "%FF%61%70%69%2Dauth%2Dtoken"],
      ["two URI encoding layers", "api%252Dauth%252Dtoken"],
      ["encoded percent and hex characters", "%25%36%31pi%252Dauth%252Dtoken"],
      ["encoded Unicode after invalid UTF-8", "%FF%C3%A9-token"],
    ] as const
  ) {
    it(`finds a credential after ${name}`, () => {
      assertEquals(containsBrokerCredential(value, ["api-auth-token", "é-token"]), true);
      assertEquals(
        containsBrokerCredential({ [value]: "value" }, ["api-auth-token", "é-token"]),
        true,
      );
    });
  }

  it("fails closed when URI nesting exceeds the bounded normalization limit", () => {
    const value = "api%" + "25".repeat(32) + "2Dauth-token";
    assertEquals(containsBrokerCredential(value, ["api-auth-token"]), true);
  });

  it("preserves unrelated text and malformed escapes without credentials", () => {
    for (const value of ["percent %ZZ text", "%FFhello%20world", "hello%2520world"]) {
      assertEquals(containsBrokerCredential(value, ["api-auth-token"]), false);
    }
  });
});
