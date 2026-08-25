import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ERROR_REGISTRY, getAllSlugs } from "../../src/errors/error-registry.ts";
import { buildErrorDocsUrl, ERROR_DOCS_BASE_URL } from "../../src/errors/diagnostic-policy.ts";
import { escapeMdxText } from "../../scripts/docs/generate-error-reference.ts";

/**
 * Every error slug the registry can emit is printed to users as a docs URL by
 * the CLI, HTTP, and log boundaries. These tests iterate the registry rather
 * than sampling known slugs, so adding an error without publishing its
 * destination fails here instead of shipping a dead link.
 */

/** Prefix under which veryfront-code's docs/ tree is published. */
const PUBLISHED_DOCS_PREFIX = "https://veryfront.com/docs/code/";

/**
 * Resolve the published error-docs URL back to the repository file that has to
 * carry its anchors. Deriving the path (instead of hardcoding it) means moving
 * the page without moving ERROR_DOCS_BASE_URL fails this test.
 */
function localFileForDocsBaseUrl(baseUrl: string): string {
  const withoutFragment = baseUrl.split("#")[0];
  assert(
    withoutFragment.startsWith(PUBLISHED_DOCS_PREFIX),
    `ERROR_DOCS_BASE_URL must point into the published veryfront-code docs tree ` +
      `(${PUBLISHED_DOCS_PREFIX}...), got: ${baseUrl}`,
  );
  const docPath = withoutFragment.slice(PUBLISHED_DOCS_PREFIX.length);
  return `docs/${docPath}.md`;
}

/**
 * Anchor ids a Mintlify page exposes. Headings are slugified, and the slugs in
 * this registry are already lowercase-and-hyphen, so the heading text is the
 * anchor.
 */
function anchorsIn(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of markdown.split("\n")) {
    const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line);
    if (heading) anchors.add(heading[1].toLowerCase().replace(/\s+/g, "-"));
  }
  return anchors;
}

async function* walkTypeScript(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) yield* walkTypeScript(path);
    else if (entry.isFile && (path.endsWith(".ts") || path.endsWith(".tsx"))) yield path;
  }
}

describe("error docs links", () => {
  it("points every registered slug at a published destination", async () => {
    const docFile = localFileForDocsBaseUrl(ERROR_DOCS_BASE_URL);
    const markdown = await Deno.readTextFile(docFile);
    const anchors = anchorsIn(markdown);
    const pagePath = new URL(ERROR_DOCS_BASE_URL.split("#")[0]).pathname;

    const slugs = getAllSlugs();
    assert(slugs.length > 0, "registry must not be empty");

    const dead: string[] = [];
    for (const slug of slugs) {
      const url = new URL(buildErrorDocsUrl(slug));
      // The URL must resolve to the published page...
      if (url.pathname !== pagePath) {
        dead.push(`${slug}: resolves to ${url.pathname}, not ${pagePath}`);
        continue;
      }
      // ...and to a real anchor on it.
      const fragment = decodeURIComponent(url.hash.replace(/^#/, ""));
      if (!anchors.has(fragment)) {
        dead.push(`${slug}: no "#${fragment}" anchor in ${docFile}`);
      }
    }

    assertEquals(
      dead,
      [],
      `${dead.length} of ${slugs.length} error slugs link to a destination that does not exist:\n` +
        dead.join("\n"),
    );
  });

  it("documents the fallback slug used when an error carries no usable slug", async () => {
    const docFile = localFileForDocsBaseUrl(ERROR_DOCS_BASE_URL);
    const anchors = anchorsIn(await Deno.readTextFile(docFile));
    // diagnostic-policy falls back to "unknown-error" for non-string slugs.
    const fragment = decodeURIComponent(
      new URL(buildErrorDocsUrl(undefined)).hash.replace(/^#/, ""),
    );
    assert(
      anchors.has(fragment),
      `fallback slug "#${fragment}" has no anchor in ${docFile}`,
    );
  });

  it("does not document anchors for slugs the registry no longer emits", async () => {
    const docFile = localFileForDocsBaseUrl(ERROR_DOCS_BASE_URL);
    const markdown = await Deno.readTextFile(docFile);
    const registered = new Set(getAllSlugs());
    // Slug anchors are the level-3 headings; section headings are level 2.
    const slugHeadings = [...markdown.matchAll(/^###\s+(.+?)\s*$/gm)].map((m) => m[1]);
    const stale = slugHeadings.filter((heading) => !registered.has(heading));
    assertEquals(stale, [], `documented slugs no longer in the registry: ${stale.join(", ")}`);
  });

  it("escapes registry text that MDX would parse as markup", async () => {
    // The published page renders as MDX. Registry text like "--port <number>"
    // parses as an unclosed JSX tag and fails the docs build, so the whole
    // page must carry no unescaped "<" or "{".
    const docFile = localFileForDocsBaseUrl(ERROR_DOCS_BASE_URL);
    const markdown = await Deno.readTextFile(docFile);
    const unescaped: string[] = [];
    markdown.split("\n").forEach((line, index) => {
      if (/(^|[^\\])[<{]/.test(line)) unescaped.push(`${docFile}:${index + 1}: ${line.trim()}`);
    });
    assertEquals(
      unescaped,
      [],
      `unescaped MDX markup characters would break the docs build:\n${unescaped.join("\n")}`,
    );
  });

  it("builds every shipped error docs link through the shared builder", async () => {
    // A hardcoded link bypasses buildErrorDocsUrl and so bypasses every check
    // above -- it can rot into a 404 on its own.
    const offenders: string[] = [];
    const roots = ["src", "cli"];
    for (const root of roots) {
      for await (const entry of walkTypeScript(root)) {
        if (entry.endsWith(".test.ts") || entry.includes(".generated.")) continue;
        const source = await Deno.readTextFile(entry);
        for (const line of source.split("\n")) {
          // The constant itself and doc comments describing the shape are fine.
          if (entry.endsWith("src/errors/diagnostic-policy.ts")) continue;
          if (!line.includes("veryfront.com/docs/code/guides/errors#")) continue;
          if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) continue;
          offenders.push(`${entry}: ${line.trim()}`);
        }
      }
    }
    assertEquals(
      offenders,
      [],
      `hardcoded error docs links (use buildErrorDocsUrl instead):\n${offenders.join("\n")}`,
    );
  });

  it("documents the title and suggestion the boundaries print for each slug", async () => {
    const docFile = localFileForDocsBaseUrl(ERROR_DOCS_BASE_URL);
    const markdown = await Deno.readTextFile(docFile);
    const missing: string[] = [];
    for (const slug of getAllSlugs()) {
      const entry = (ERROR_REGISTRY as Record<string, {
        title: string;
        suggestion?: string;
      }>)[slug];
      // Registry text is MDX-escaped on the page (see escapeMdxText), so
      // compare against the escaped form the reader actually gets.
      if (!markdown.includes(escapeMdxText(entry.title))) missing.push(`${slug}: title`);
      if (entry.suggestion && !markdown.includes(escapeMdxText(entry.suggestion))) {
        missing.push(`${slug}: suggestion`);
      }
    }
    assertEquals(missing, [], `page is missing registry content:\n${missing.join("\n")}`);
  });
});
