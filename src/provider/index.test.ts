import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as provider from "./index.ts";

describe("provider public API", () => {
  it("does not expose credential-bearing cloud internals", () => {
    const internalExports = [
      "getCurrentVeryfrontCloudContext",
      "getVeryfrontCloudBootstrap",
      "markCurrentVeryfrontCloudBillingGroupUsed",
      "runWithVeryfrontCloudContext",
      "runWithVeryfrontCloudContextAsync",
    ];

    assertEquals(
      Object.keys(provider).filter((name) => internalExports.includes(name)),
      [],
    );
  });
});
