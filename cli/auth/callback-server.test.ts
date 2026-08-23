import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getCallbackUrl } from "./callback-server.ts";

describe("Callback Server", () => {
  describe("getCallbackUrl", () => {
    it("should return correct callback URL format", () => {
      assertEquals(getCallbackUrl(9876), "http://localhost:9876/callback");
    });

    it("should use the provided port", () => {
      assertEquals(getCallbackUrl(12345), "http://localhost:12345/callback");
    });
  });
});
