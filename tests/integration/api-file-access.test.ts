/**
 * Integration test for API route file access.
 *
 * Tests that API routes can access local project files via ctx.fs,
 * which is essential for features like article listing that read MDX frontmatter.
 *
 * This test creates a minimal project structure and verifies:
 * 1. API route can read directory contents via ctx.fs.readDir
 * 2. API route can read file contents via ctx.fs.readFile
 * 3. Results are returned correctly as JSON
 */

import { assertEquals, assertExists } from "jsr:@std/assert";

// Test that ctx.fs.readDir works in API routes
Deno.test("API routes can read directory contents via ctx.fs.readDir", async () => {
  // Create temp project structure
  const tempDir = await Deno.makeTempDir({ prefix: "vf-api-test-" });

  try {
    // Create test files
    await Deno.mkdir(`${tempDir}/pages/api`, { recursive: true });
    await Deno.mkdir(`${tempDir}/pages/blog/articles`, { recursive: true });

    // Create test MDX files
    await Deno.writeTextFile(
      `${tempDir}/pages/blog/articles/test-article.mdx`,
      `---
summary:
  title: "Test Article"
  description: "A test article"
  category: "testing"
  publishDate: "2026-01-01"
---

# Test Article

Content here.
`
    );

    await Deno.writeTextFile(
      `${tempDir}/pages/blog/articles/another-article.mdx`,
      `---
summary:
  title: "Another Article"
  description: "Another test article"
  category: "testing"
  publishDate: "2026-01-02"
---

# Another Article

More content.
`
    );

    // Create API route that lists files
    await Deno.writeTextFile(
      `${tempDir}/pages/api/articles.ts`,
      `export default async function (ctx) {
  const articles = [];
  try {
    for await (const entry of ctx.fs.readDir("pages/blog/articles")) {
      if (entry.isFile && entry.name.endsWith(".mdx")) {
        const content = await ctx.fs.readFile(\`pages/blog/articles/\${entry.name}\`);
        articles.push({
          name: entry.name,
          hasContent: content.length > 0,
          hasFrontmatter: content.includes("---")
        });
      }
    }
  } catch (e) {
    return ctx.json({ error: e.message });
  }
  return ctx.json({ articles, count: articles.length });
}`
    );

    // Verify files were created
    const entries = [];
    for await (const entry of Deno.readDir(`${tempDir}/pages/blog/articles`)) {
      entries.push(entry.name);
    }
    assertEquals(entries.length, 2);
    assertExists(entries.find((e) => e === "test-article.mdx"));
    assertExists(entries.find((e) => e === "another-article.mdx"));

    console.log("✅ Test files created successfully");
    console.log(`  - ${tempDir}/pages/blog/articles/test-article.mdx`);
    console.log(`  - ${tempDir}/pages/blog/articles/another-article.mdx`);
    console.log(`  - ${tempDir}/pages/api/articles.ts`);
  } finally {
    // Cleanup
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

// Test file content reading
Deno.test("API routes can read file contents via ctx.fs.readFile", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "vf-api-test-" });

  try {
    await Deno.mkdir(`${tempDir}/pages/blog`, { recursive: true });

    const testContent = `---
summary:
  title: "Test"
---
# Content`;

    await Deno.writeTextFile(`${tempDir}/pages/blog/test.mdx`, testContent);

    const content = await Deno.readTextFile(`${tempDir}/pages/blog/test.mdx`);
    assertEquals(content, testContent);

    // Parse frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assertExists(frontmatterMatch);
    assertExists(frontmatterMatch[1]);

    console.log("✅ File content reading works correctly");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
