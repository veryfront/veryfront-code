import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

// The lint shard runs both validators, so their failure output lands in CI
// logs. It must name files relative to the checked root, never by the
// absolute path of the machine that ran the check.

async function runValidator(
  script: string,
  root: string,
): Promise<{ code: number; output: string }> {
  const result = await new Deno.Command("deno", {
    args: ["run", "--allow-read", new URL(`../../../${script}`, import.meta.url).pathname, root],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    output: decoder.decode(result.stdout) + decoder.decode(result.stderr),
  };
}

async function withFixture(
  files: Record<string, string>,
  check: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "validator-output-paths-" });
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = `${root}/${path}`;
      await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
      await Deno.writeTextFile(target, content);
    }
    await check(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

describe("docs validator output paths", () => {
  it("the API reference validator reports root-relative paths", async () => {
    await withFixture({
      "deno.json": JSON.stringify({ exports: { "./agent": "./src/agent/index.ts" } }),
      "docs/api-reference/veryfront/extra.md": "| `thing` | Handle things. | more |\n",
    }, async (root) => {
      const { code, output } = await runValidator("scripts/docs/validate-api-reference.ts", root);
      assertEquals(code, 1);
      assertStringIncludes(output, "veryfront/agent -> docs/api-reference/veryfront/agent.md");
      assertStringIncludes(output, "extra -> docs/api-reference/veryfront/extra.md");
      assertStringIncludes(output, "  docs/api-reference/veryfront/extra.md:1");
      assert(!output.includes(root), "validator output must not contain the absolute root");
    });
  });

  it("the doc link checker reports root-relative paths", async () => {
    await withFixture({
      "docs/guide.md": "[Present](./other.md)\n[Missing](./missing.md)\n",
      "docs/other.md": "Text\n",
    }, async (root) => {
      for (const argument of [root, `${root}/`]) {
        const { code, output } = await runValidator("scripts/lint/check-doc-links.ts", argument);
        assertEquals(code, 1);
        assertStringIncludes(output, "Broken link in docs/guide.md: ./missing.md");
        assertStringIncludes(output, "Found 1 broken doc link(s)");
        assert(!output.includes(root), "checker output must not contain the absolute root");
      }
    });
  });
});
