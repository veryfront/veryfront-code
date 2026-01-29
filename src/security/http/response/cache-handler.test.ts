import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { buildCacheControl } from "./cache-handler.ts";
import { CACHE_DURATIONS } from "./constants.ts";

describe("security/http/response/cache-handler", () => {
  describe("buildCacheControl", () => {
    describe("string presets", () => {
      it("should return no-cache preset", () => {
        assertEquals(
          buildCacheControl("no-cache"),
          "no-cache, no-store, must-revalidate",
        );
      });

      it("should return no-store preset", () => {
        assertEquals(buildCacheControl("no-store"), "no-store");
      });

      it("should return short preset", () => {
        assertEquals(
          buildCacheControl("short"),
          `public, max-age=${CACHE_DURATIONS.SHORT}`,
        );
      });

      it("should return medium preset", () => {
        assertEquals(
          buildCacheControl("medium"),
          `public, max-age=${CACHE_DURATIONS.MEDIUM}`,
        );
      });

      it("should return long preset", () => {
        assertEquals(
          buildCacheControl("long"),
          `public, max-age=${CACHE_DURATIONS.LONG}`,
        );
      });

      it("should return immutable preset", () => {
        assertEquals(
          buildCacheControl("immutable"),
          `public, max-age=${CACHE_DURATIONS.LONG}, immutable`,
        );
      });

      it("should return none preset", () => {
        assertEquals(
          buildCacheControl("none"),
          "no-cache, no-store, must-revalidate",
        );
      });

      it("should fallback for unknown string preset", () => {
        // TypeScript wouldn't normally allow this but testing runtime behavior
        assertEquals(
          buildCacheControl("unknown" as "short"),
          "public, max-age=0",
        );
      });
    });

    describe("object config", () => {
      it("should build public cache with maxAge", () => {
        assertEquals(
          buildCacheControl({ maxAge: 3600 }),
          "public, max-age=3600",
        );
      });

      it("should build private cache", () => {
        assertEquals(
          buildCacheControl({ maxAge: 600, public: false }),
          "private, max-age=600",
        );
      });

      it("should include immutable flag", () => {
        assertEquals(
          buildCacheControl({ maxAge: 31536000, immutable: true }),
          "public, max-age=31536000, immutable",
        );
      });

      it("should include must-revalidate flag", () => {
        assertEquals(
          buildCacheControl({ maxAge: 0, mustRevalidate: true }),
          "public, max-age=0, must-revalidate",
        );
      });

      it("should combine all flags", () => {
        const result = buildCacheControl({
          maxAge: 3600,
          public: false,
          immutable: true,
          mustRevalidate: true,
        });
        assert(result.includes("private"));
        assert(result.includes("max-age=3600"));
        assert(result.includes("immutable"));
        assert(result.includes("must-revalidate"));
      });
    });
  });
});
