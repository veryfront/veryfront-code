import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveImageVariantWidths } from "#veryfront/utils/image-variant-widths.ts";

describe("resolveImageVariantWidths", () => {
  it("emits only the intrinsic width below the smallest default target", () => {
    assertEquals(resolveImageVariantWidths(320), [320]);
  });

  it("filters, deduplicates, and sorts configured widths before the intrinsic width", () => {
    assertEquals(resolveImageVariantWidths(1_000, [320]), [320, 1_000]);
    assertEquals(resolveImageVariantWidths(1_000, [800, 400, 800, 1_200]), [
      400,
      800,
      1_000,
    ]);
    assertEquals(resolveImageVariantWidths(800, [800, 1_200]), [800]);
  });

  it("rejects dimensions the build optimizer cannot emit", () => {
    for (const width of [0, 1.5, Number.NaN, 32_769]) {
      assertThrows(
        () => resolveImageVariantWidths(width),
        TypeError,
        "Image source width",
        `source width ${width} must be rejected`,
      );
    }

    for (const width of [0, -320, 1.5, Number.NaN, 32_769]) {
      assertThrows(
        () => resolveImageVariantWidths(2_000, [width]),
        TypeError,
        "Configured image width",
        `configured width ${width} must be rejected`,
      );
    }
  });
});
