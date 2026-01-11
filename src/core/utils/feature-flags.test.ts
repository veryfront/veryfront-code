import { assertEquals } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
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
      const config = { experimental: { rsc: true } };
      assertEquals(isRSCEnabled(config), true);
    });

    it("should return false when config.experimental.rsc is false", () => {
      const config = { experimental: { rsc: false } };
      assertEquals(isRSCEnabled(config), false);
    });

    it("should return true when env VERYFRONT_EXPERIMENTAL_RSC is 1", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
      assertEquals(isRSCEnabled(), true);
    });

    it("should return false when env is not set and no config", () => {
      Deno.env.delete("VERYFRONT_EXPERIMENTAL_RSC");
      assertEquals(isRSCEnabled(), false);
    });

    it("should return false when env is set to something other than 1", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "0");
      assertEquals(isRSCEnabled(), false);

      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "true");
      assertEquals(isRSCEnabled(), false);
    });

    it("should prefer config over env when config is provided", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
      const config = { experimental: { rsc: false } };
      assertEquals(isRSCEnabled(config), false);
    });

    it("should fall back to env when config.experimental is missing", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
      assertEquals(isRSCEnabled({}), true);
    });

    it("should fall back to env when config.experimental.rsc is undefined", () => {
      Deno.env.set("VERYFRONT_EXPERIMENTAL_RSC", "1");
      const config = { experimental: {} };
      assertEquals(isRSCEnabled(config), true);
    });
  });
});
