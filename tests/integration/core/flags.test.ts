import { assertEquals } from "#veryfront/testing/assert";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { isRSCEnabled } from "#veryfront/utils/feature-flags.ts";

describe("flags", () => {
  describe("isRSCEnabled", () => {
    afterEach(() => {
      Deno.env.delete("VERYFRONT_EXPERIMENTAL_RSC");
    });

    it("returns false by default", () => {
      assertEquals(isRSCEnabled(), false);
    });

    it("returns true when env is set to 1", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
      assertEquals(isRSCEnabled(), true);
    });

    it("returns false when env is set to 0", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "0");
      assertEquals(isRSCEnabled(), false);
    });

    it("config.experimental.rsc takes precedence over env", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
      assertEquals(
        isRSCEnabled({ experimental: { rsc: false } }),
        false,
      );

      Deno.env.delete("VERYFRONT_EXPERIMENTAL_RSC");
      assertEquals(
        isRSCEnabled({ experimental: { rsc: true } }),
        true,
      );
    });

    it("falls back to env when config has no rsc field", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
      assertEquals(isRSCEnabled({}), true);

      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "0");
      assertEquals(isRSCEnabled({}), false);
    });
  });
});
