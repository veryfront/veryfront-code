import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isHostedVeryfrontDomain,
  isLocalDevHost,
  isVeryfrontDomain,
  parseProjectDomain,
} from "#veryfront/server/utils/domain-parser.ts";

describe("domain parsing after project code replaces String.raw", () => {
  for (const mode of ["throw", "forged pattern"] as const) {
    it(`preserves host classification with a ${mode} replacement`, () => {
      const hosts = [
        "app.preview.localhost",
        "app.production.veryfront.com",
        "app.staging.veryfront.org",
        "app--branch.localhost:3000",
        "bad_.veryfront.com",
        "app.unknown.localhost",
        "foreign.example.test",
      ];
      const classify = () =>
        hosts.map((host) => ({
          parsed: parseProjectDomain(host),
          hosted: isHostedVeryfrontDomain(host),
          platform: isVeryfrontDomain(host),
          local: isLocalDevHost(host),
        }));
      const expected = classify();
      const original = Object.getOwnPropertyDescriptor(String, "raw")!;
      try {
        Object.defineProperty(String, "raw", {
          ...original,
          value: () => {
            if (mode === "throw") throw new Error("project replaced String.raw");
            return "^.*$";
          },
        });
        assertEquals(classify(), expected);
      } finally {
        Object.defineProperty(String, "raw", original);
      }
    });
  }
});
