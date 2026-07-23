import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { HTMLGenerationOptionsSchema, HydrationDataSchema } from "./html.schema.ts";
import { MAX_STUDIO_CONFIG_ID_LENGTH } from "#veryfront/studio/limits.ts";

describe("html/schemas", () => {
  const baseOptions = { mode: "production", config: {} } as const;

  it("accepts bounded HTML generation options", () => {
    assertEquals(HTMLGenerationOptionsSchema.safeParse(baseOptions).success, true);
  });

  it("rejects nested layout collections beyond the runtime limit", () => {
    const result = HTMLGenerationOptionsSchema.safeParse({
      ...baseOptions,
      nestedLayouts: Array.from(
        { length: 65 },
        (_, index) => ({ kind: "tsx", path: `app/layout-${index}.tsx` }),
      ),
    });

    assertEquals(result.success, false);
  });

  it("rejects oversized release identifiers", () => {
    assertEquals(
      HTMLGenerationOptionsSchema.safeParse({
        ...baseOptions,
        releaseId: "r".repeat(257),
      }).success,
      false,
    );
  });

  it("accepts a separate Studio source path and enforces the bridge page ID limit", () => {
    assertEquals(
      HTMLGenerationOptionsSchema.safeParse({
        ...baseOptions,
        pagePath: "_snippets/abc123",
        studioProjectId: "s".repeat(MAX_STUDIO_CONFIG_ID_LENGTH),
        studioPagePath: "components/button.snippet.mdx",
        pageId: "p".repeat(MAX_STUDIO_CONFIG_ID_LENGTH),
      }).success,
      true,
    );
    assertEquals(
      HTMLGenerationOptionsSchema.safeParse({
        ...baseOptions,
        pageId: "p".repeat(MAX_STUDIO_CONFIG_ID_LENGTH + 1),
      }).success,
      false,
    );
    assertEquals(
      HTMLGenerationOptionsSchema.safeParse({
        ...baseOptions,
        studioProjectId: "s".repeat(MAX_STUDIO_CONFIG_ID_LENGTH + 1),
      }).success,
      false,
    );
  });

  it("rejects excessive import-map entries", () => {
    const importMap = Object.fromEntries(
      Array.from(
        { length: 1025 },
        (_, index) => [`package-${index}`, `/modules/package-${index}.js`],
      ),
    );

    assertEquals(
      HTMLGenerationOptionsSchema.safeParse({ ...baseOptions, importMap }).success,
      false,
    );
  });

  it("rejects invalid project CSS candidate sets", () => {
    assertEquals(
      HTMLGenerationOptionsSchema.safeParse({
        ...baseOptions,
        projectClasses: new Set(["x".repeat(1025)]),
      }).success,
      false,
    );
  });

  it("rejects hydration layout collections beyond the client limit", () => {
    const result = HydrationDataSchema.safeParse({
      slug: "test",
      props: {},
      params: {},
      layouts: Array.from(
        { length: 65 },
        (_, index) => ({ kind: "tsx", path: `app/layout-${index}.tsx` }),
      ),
    });

    assertEquals(result.success, false);
  });
});
