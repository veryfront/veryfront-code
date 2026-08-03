import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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

      it("rejects unknown string presets", () => {
        assertThrows(() => buildCacheControl("unknown" as never), TypeError);
      });
    });

    describe("object config", () => {
      it("should build public cache with maxAge", () => {
        assertEquals(buildCacheControl({ maxAge: 3600 }), "public, max-age=3600");
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

      it("should include stale-while-revalidate when configured", () => {
        assertEquals(
          buildCacheControl({ maxAge: 60, staleWhileRevalidate: 1800 }),
          "public, max-age=60, stale-while-revalidate=1800",
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

      it("rejects malformed and accessor-backed cache options", () => {
        for (
          const strategy of [
            { maxAge: -1 },
            { maxAge: 1.5 },
            { maxAge: Number.POSITIVE_INFINITY },
            { maxAge: 60, staleWhileRevalidate: -1 },
            { maxAge: 60, public: "yes" },
            { maxAge: 60, unknown: true },
            Object.create({ maxAge: 60 }),
          ]
        ) {
          assertThrows(() => buildCacheControl(strategy as never), TypeError);
        }

        let getterCalls = 0;
        const strategy = {} as Record<string, unknown>;
        Object.defineProperty(strategy, "maxAge", {
          enumerable: true,
          get() {
            getterCalls++;
            return 60;
          },
        });
        assertThrows(() => buildCacheControl(strategy as never), TypeError);
        assertEquals(getterCalls, 0);
      });
    });
  });
});
