import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { compileMDXToJS } from "./mdx-to-js.ts";

describe("build/compiler/mdx-to-js", () => {
  it("preserves real component imports without placeholder components", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const result = await compileMDXToJS(
        `${projectDir}/page.mdx`,
        'import Card from "./Card.tsx"\n\n<Card />',
        { projectDir, mode: "production", adapter: createMockAdapter() },
      );

      assertStringIncludes(result.code, "Card.tsx");
      assertEquals(result.code.includes("missing-component"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects malformed frontmatter", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await assertRejects(
        () =>
          compileMDXToJS(
            `${projectDir}/page.mdx`,
            "---\ntitle: [broken\n---\n# Heading",
            { projectDir, mode: "production", adapter: createMockAdapter() },
          ),
        Error,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects source paths outside projectDir", async () => {
    const projectDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    try {
      await assertRejects(
        () =>
          compileMDXToJS(
            `${outsideDir}/page.mdx`,
            "# Heading",
            { projectDir, mode: "production", adapter: createMockAdapter() },
          ),
        TypeError,
        "outside projectDir",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("rejects invalid runtime options before invoking the content processor", async () => {
    await assertRejects(
      () =>
        compileMDXToJS("page.mdx", "# Heading", {
          projectDir: " ",
          mode: "production",
          adapter: createMockAdapter(),
        }),
      TypeError,
      "projectDir",
    );
    await assertRejects(
      () =>
        compileMDXToJS("page.mdx", "# Heading", {
          projectDir: "/project",
          mode: "preview" as never,
          adapter: createMockAdapter(),
        }),
      TypeError,
      "mode",
    );
  });

  it("rejects non-scalar reserved frontmatter fields", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await assertRejects(
        () =>
          compileMDXToJS(
            `${projectDir}/page.mdx`,
            "---\ntitle:\n  - invalid\n---\n# Heading",
            { projectDir, mode: "production", adapter: createMockAdapter() },
          ),
        TypeError,
        "title",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
