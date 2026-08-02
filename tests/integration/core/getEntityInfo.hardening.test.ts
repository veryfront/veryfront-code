/**
 * Hardening cases for route, layout and entity resolution.
 *
 * Ported from origin/codex/module-reconcile-20260723, where the suite was
 * written against src/rendering/entity-resolution.ts — a 1045-line rewrite that
 * exists only on that branch. Main's equivalent is this repo's 480-line
 * src/types/entities/getEntityInfo.ts.
 *
 * The cases kept below are the ones that describe main's contract. Four defects
 * they exposed were fixed in production rather than asserted away: the detached
 * getEntityIdForPath receiver, case-sensitive extension matching, non-canonical
 * resolved slugs, and the missing directory-index candidate in the resolveFile
 * branch.
 *
 * Twenty-seven further cases specify subsystems main has never had. They are
 * not ported here, because a permanently-ignored test is dead coverage the
 * skipped-test ratchet exists to prevent (see tests/README.md). They remain
 * available in full at:
 *
 *   git show origin/codex/module-reconcile-20260723:tests/integration/core/getEntityInfo.hardening.test.ts
 *
 * Grouped by the subsystem each one needs, so a decision can be made per group:
 *
 *  1. Route-conflict reporting — main registers the `route-conflict` error in
 *     src/errors/error-registry/route.ts but never throws it; duplicate routes
 *     resolve silently by extension priority. Cases: "reports ambiguous dynamic
 *     pages at the same route depth", "reports duplicate exact page
 *     definitions", "reports duplicate exact pages hidden by adapter extension
 *     priority", "reports case-variant duplicate extensions returned by adapter
 *     directories", "reports duplicate layout definitions".
 *  2. Path and identifier bounds — no length ceiling or control-character
 *     screening on slugs, composed candidates, adapter-canonicalized paths or
 *     hosted entity ids. Cases: "rejects route slugs beyond the path boundary
 *     before filesystem access", "rejects route controls before filesystem
 *     access", "rejects composed candidate paths beyond the path boundary",
 *     "rejects overlong canonical paths returned by an adapter", "rejects
 *     hosted entity identifiers containing control characters".
 *  3. Traversal budgets — directory iteration and dynamic traversal are
 *     unbounded. Cases: "bounds adapter directory iteration", "bounds dynamic
 *     directory traversal across one route lookup", "charges invalid entries
 *     against the global dynamic traversal budget".
 *  4. Directory-entry integrity — entries are consumed as yielded, without
 *     validation or defensive copying. Cases: "rejects unsafe and structurally
 *     impossible directory entries", "snapshots adapter directory entries
 *     before asynchronous mutation".
 *  5. Root canonicalization — main never calls adapter realPath, so there is no
 *     canonical root to contain resolved paths against. Cases: "propagates an
 *     immediate root canonicalization failure before touching candidates",
 *     "propagates a deferred root canonicalization failure before touching
 *     candidates", "supports Cloudflare KV containment without allowing
 *     resolved path escapes".
 *  6. Error propagation policy — main deliberately catches and degrades where
 *     the branch propagates (see the documented catch blocks in
 *     getEntityInfo.ts). Reversing that is a product decision, not a fix.
 *     Cases: "propagates hosted adapter entity identifier failures", "does not
 *     reinterpret entity identifier failures as missing files", "propagates
 *     failures while inspecting the authoritative entity identifier hook",
 *     "preserves an unreadable adapter rejection without reclassifying it",
 *     "preserves adapter directory errors during exact-page discovery", "does
 *     not invoke an accessor masquerading as the optional entity identifier
 *     hook".
 *  7. Frontmatter type scrubbing — main passes YAML attrs through unvalidated,
 *     so a declared-string field can hold a number. Case: "removes invalid
 *     values from typed frontmatter fields".
 *  8. Page-source size limit — no ceiling on entity source length. Case:
 *     "rejects entity sources beyond the bounded page-source limit".
 *  9. Nested dynamic directory traversal — main only walks literal parent
 *     directories, so `pages/blog/[category]/[slug].mdx` never matches. Case:
 *     "resolves routes with consecutive dynamic path segments".
 */
import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path";
import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { CloudflareFileSystemAdapter } from "#veryfront/platform/adapters/runtime/cloudflare/filesystem.ts";
import type { KVNamespace } from "#veryfront/platform/adapters/runtime/cloudflare/types.ts";
import {
  getEntityBySlug,
  getEntityInfo,
  getLayoutEntity,
} from "../../../src/types/entities/getEntityInfo.ts";

function createCloudflareKV(initialEntries: Record<string, string>): KVNamespace {
  const entries = new Map(Object.entries(initialEntries));
  return {
    delete(key) {
      entries.delete(key);
      return Promise.resolve();
    },
    get(key) {
      return Promise.resolve(entries.get(key) ?? null);
    },
    getWithMetadata(key) {
      return Promise.resolve({ metadata: null, value: entries.get(key) ?? null });
    },
    list(options = {}) {
      const prefix = options.prefix ?? "";
      return Promise.resolve({
        keys: [...entries.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
        cursor: "",
      });
    },
    put(key, value) {
      entries.set(
        key,
        typeof value === "string" ? value : new TextDecoder().decode(value as ArrayBuffer),
      );
      return Promise.resolve();
    },
  };
}

describe("getEntityInfo", () => {
  it("preserves the hosted adapter receiver during entity identifier lookup", async () => {
    const underlyingAdapter = {
      prefix: "entity",
      getEntityIdForPath(path: string) {
        return `${this.prefix}:${path}`;
      },
    };
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        readFile: () => Promise.resolve("# Page"),
      },
    } as unknown as RuntimeAdapter;

    const result = await getEntityInfo("pages/page.mdx", adapter);

    assertExists(result);
    assertEquals(result.entity.id, "entity:pages/page.mdx");
  });

  it("normalizes slugs from case-insensitive supported extensions", async () => {
    await withTempDir(async (projectDir) => {
      const pagePath = join(projectDir, "article.MDX");
      await writeTextFile(pagePath, "# Article");

      const result = await getEntityInfo(pagePath);

      assertExists(result);
      assertEquals(result.entity.slug, "article");
      assertEquals(result.entity.kind, "mdx");
    });
  });

  // The branch derived a full route path here ("blog/guides"). Main's slug is
  // the containing directory name, pinned by "extracts slug correctly" in
  // getEntityInfo.test.ts, so the assertion follows main's contract. The case
  // still covers what it was written for: an uppercase INDEX.MDX is recognized
  // as a directory index and has its extension stripped.
  it("derives a route slug for nested case-insensitive index files", async () => {
    await withTempDir(async (projectDir) => {
      const pagePath = join(projectDir, "pages", "blog", "guides", "INDEX.MDX");
      await mkdir(join(projectDir, "pages", "blog", "guides"), { recursive: true });
      await writeTextFile(pagePath, "# Guides");

      const result = await getEntityInfo(pagePath);

      assertExists(result);
      assertEquals(result.entity.slug, "guides");
    });
  });
});

describe("getEntityBySlug", () => {
  it("resolves relative Cloudflare KV projects from the canonical virtual root", async () => {
    const fs = new CloudflareFileSystemAdapter(createCloudflareKV({
      "pages/about.mdx": "# Relative about",
    }));
    const adapter: RuntimeAdapter = {
      ...createMockAdapter(),
      id: "cloudflare",
      fs,
    };

    const page = await getEntityBySlug(".", "about", adapter);

    assertEquals(page?.entity.content, "# Relative about");
    assertEquals(page?.entity.slug, "about");
  });

  it("normalizes adapter-resolved dot segments and backslashes before KV reads", async () => {
    const fs = new CloudflareFileSystemAdapter(createCloudflareKV({
      "/project/pages/about.mdx": "# Canonical about",
    }));
    Object.assign(fs, {
      resolveFile: (path: string) =>
        Promise.resolve(
          path.endsWith("/pages/about") ? "/project\\pages\\.\\about.mdx" : null,
        ),
    });
    const adapter: RuntimeAdapter = {
      ...createMockAdapter(),
      id: "cloudflare",
      fs,
    };

    const page = await getEntityBySlug("/project", "about", adapter);

    assertEquals(page?.entity.content, "# Canonical about");
    assertEquals(page?.entity.slug, "about");
  });

  it("resolves dynamic pages with case-insensitive supported extensions", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages", "blog");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(join(pagesDir, "[slug].MDX"), "# Dynamic page");

      const result = await getEntityBySlug(projectDir, "blog/entry");

      assertExists(result);
      assertEquals(result.entity.slug, "blog/entry");
      assertEquals(result.entity.content, "# Dynamic page");
    });
  });

  it("ignores same-priority dynamic files that are not pages", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages", "blog");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(
        join(pagesDir, "[layout].mdx"),
        "---\nisLayout: true\n---\n# Dynamic layout",
      );
      await writeTextFile(join(pagesDir, "[slug].mdx"), "# Dynamic page");

      const result = await getEntityBySlug(projectDir, "blog/entry");

      assertExists(result);
      assertEquals(result.entity.content, "# Dynamic page");
    });
  });

  it("does not treat extra filename suffixes as dynamic route syntax", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(join(pagesDir, "[slug].draft.mdx"), "# Draft");

      assertEquals(await getEntityBySlug(projectDir, "entry"), null);
    });
  });

  it("deduplicates repeated adapter directory entries deterministically", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/about.mdx", "# About");
    adapter.fs.resolveFile = () => Promise.resolve("/project/pages/about.mdx");
    adapter.fs.readDir = async function* (path: string) {
      if (path !== "/project/pages") return;
      const entry = {
        name: "about.mdx",
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      };
      yield entry;
      yield { ...entry };
    };

    const result = await getEntityBySlug("/project", "about", adapter);

    assertEquals(result?.entity.content, "# About");
  });

  it("returns a canonical slug after resolving redundant path segments", async () => {
    await withTempDir(async (projectDir) => {
      const pagesDir = join(projectDir, "pages");
      await mkdir(pagesDir, { recursive: true });
      await writeTextFile(join(pagesDir, "about.mdx"), "# About");

      const result = await getEntityBySlug(projectDir, "//./about//");

      assertExists(result);
      assertEquals(result.entity.slug, "about");
    });
  });

  it("resolves directory index pages through adapter resolveFile", async () => {
    const underlyingAdapter = {};
    const adapter = {
      fs: {
        isVeryfrontAdapter: () => false,
        getUnderlyingAdapter: () => underlyingAdapter,
        isMultiProjectMode: () => false,
        getAdapterType: () => "GitHubFSAdapter",
        resolveFile: (path: string) =>
          Promise.resolve(
            path.endsWith("/pages/about/index") ? "pages/about/index.mdx" : null,
          ),
        stat: () =>
          Promise.resolve({
            size: 7,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: null,
          }),
        readFile: () => Promise.resolve("# About"),
        readDir: async function* () {},
      },
    } as unknown as RuntimeAdapter;

    const result = await getEntityBySlug("/project", "about", adapter);

    assertExists(result);
    assertEquals(result.entity.slug, "about");
    assertEquals(result.entity.content, "# About");
  });
});

describe("getLayoutEntity", () => {
  it("resolves explicit layout paths with case-insensitive supported extensions", async () => {
    await withTempDir(async (projectDir) => {
      const layoutPath = join(projectDir, "components", "DefaultLayout.MDX");
      await mkdir(join(projectDir, "components"), { recursive: true });
      await writeTextFile(layoutPath, "---\nisLayout: true\n---\n# Default layout");

      const result = await getLayoutEntity(
        projectDir,
        "components/DefaultLayout.MDX",
      );

      assertExists(result);
      assertEquals(result.entity.isLayout, true);
      assertEquals(result.entity.content, "# Default layout");
    });
  });

  it("does not apply the layout convention to explicit page paths", async () => {
    await withTempDir(async (projectDir) => {
      const pagePath = join(projectDir, "pages", "main.mdx");
      await mkdir(join(projectDir, "pages"), { recursive: true });
      await writeTextFile(pagePath, "# Main page");

      assertEquals(
        await getLayoutEntity(projectDir, "pages/main.mdx"),
        null,
      );
    });
  });

  // UNRESOLVED — needs a product decision, not a test fix.
  //
  // getLayoutEntity(dir, "main") resolves layouts/main.mdx through the
  // layouts-directory convention ("files in layouts/ are layouts by
  // convention, any extension"), but naming the same file explicitly as
  // "layouts/main.mdx" returns null, because the explicit-path branch demands
  // that detectEntityType recognise it independently. Two spellings of one
  // file, two answers.
  //
  // Applying the convention to explicit paths under layouts/ would make this
  // green and would not affect the "explicit page paths" case above, which is
  // about pages/. It was left alone because the explicit-path branch carries a
  // deliberate comment ("don't fall back to convention-based discovery"), so
  // whether layouts/ is exempt from it is a contract call for a human.
  it.ignore("applies the layouts-directory convention to explicit file paths", async () => {
    await withTempDir(async (projectDir) => {
      const layoutPath = join(projectDir, "layouts", "main.mdx");
      await mkdir(join(projectDir, "layouts"), { recursive: true });
      await writeTextFile(layoutPath, "# Main layout");

      const result = await getLayoutEntity(projectDir, "layouts/main.mdx");

      assertExists(result);
      assertEquals(result.entity.type, "layout");
      assertEquals(result.entity.content, "# Main layout");
    });
  });
});
