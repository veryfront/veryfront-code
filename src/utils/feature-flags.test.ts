import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isRSCEnabled } from "./feature-flags.ts";

describe("feature-flags", () => {
  describe("isRSCEnabled", () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = Deno.env.get("VERYFRONT_EXPERIMENTAL_RSC");
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        Deno.env.delete("VERYFRONT_EXPERIMENTAL_RSC");
      } else {
        Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", originalEnv);
      }
    });

    it("should return true when config.experimental.rsc is true", () => {
      assertEquals(isRSCEnabled({ experimental: { rsc: true } }), true);
    });

    it("should return false when config.experimental.rsc is false", () => {
      assertEquals(isRSCEnabled({ experimental: { rsc: false } }), false);
    });

    it("should return true when env VERYFRONT_EXPERIMENTAL_RSC is '1'", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
      assertEquals(isRSCEnabled(), true);
    });

    it("should return false when env is not set and no config", () => {
      Deno.env.delete("VERYFRONT_EXPERIMENTAL_RSC");
      assertEquals(isRSCEnabled(), false);
    });

    it("should prefer config over env when config is provided", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
      assertEquals(isRSCEnabled({ experimental: { rsc: false } }), false);
    });

    it("should fall back to env when config.experimental is missing", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
      assertEquals(isRSCEnabled({}), true);
    });

    it("should fall back to env when config.experimental.rsc is undefined", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
      assertEquals(isRSCEnabled({ experimental: {} }), true);
    });
  });
});
