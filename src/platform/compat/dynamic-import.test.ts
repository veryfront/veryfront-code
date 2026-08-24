import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dynamicImport } from "./dynamic-import.ts";

describe("platform/compat/dynamic-import", () => {
  it("should be a function", () => {
    assertEquals(typeof dynamicImport, "function");
  });

  it("should import a built-in module", async () => {
    const mod = await dynamicImport<{ join: (...args: unknown[]) => unknown }>("node:path");
    assertExists(mod);
    assertEquals(typeof mod.join, "function");
  });

  it("should reject for a non-existent module", async () => {
    await assertRejects(
      () => dynamicImport("__nonexistent_module_12345__"),
    );
  });

  /**
   * This helper must stay OUT of client bundles.
   *
   * Its `new Function` is load-bearing on the server: it keeps the import
   * non-literal so neither `deno compile` nor the release-asset rewriter
   * traces into the specifier. But project pages ship
   * `script-src 'self' 'nonce-...' https://esm.sh` with no 'unsafe-eval', so
   * reaching it from a client entry throws EvalError and kills hydration
   * before first paint.
   *
   * Removing the `new Function` is NOT the fix — the release-asset builder
   * then rejects the module with "Release module contains a non-literal
   * dynamic import". Keep the eval, keep it off the client.
   */
  describe("client bundle reachability", () => {
    const SRC_ROOT = new URL("../../", import.meta.url);

    /** Client entries behind PLATFORM_UTILITY_PATHS (src/html/utils.ts). */
    const CLIENT_ENTRIES = [
      "react/runtime/core.ts",
      "react/fonts/index.ts",
      "react/components/ui/index.ts",
      "chat/index.ts",
      "markdown/index.ts",
      "mdx/index.ts",
      "workflow/react/index.ts",
    ];

    function read(relPath: string): string | null {
      try {
        return Deno.readTextFileSync(new URL(relPath, SRC_ROOT));
      } catch {
        return null;
      }
    }

    function resolveSpecifier(specifier: string, fromRel: string): string | null {
      let base: string;
      if (specifier.startsWith("#veryfront/")) {
        base = specifier.slice("#veryfront/".length);
      } else if (specifier.startsWith(".")) {
        const dir = fromRel.includes("/") ? fromRel.slice(0, fromRel.lastIndexOf("/")) : "";
        base = new URL(specifier, `file:///${dir}/`).pathname.replace(/^\/+/, "");
      } else {
        return null;
      }
      // index.tsx matters as much as index.ts here: the client entries walk
      // React subtrees, and src/react/components/chat/chat/index.tsx is a
      // directory module inside the one entry that actually leaked. Omitting
      // it would make the traversal stop early and silently pass.
      const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ];
      for (const candidate of candidates) {
        if (read(candidate) !== null) return candidate;
      }
      return null;
    }

    /** Value imports only — `import type` is erased and never ships. */
    function valueImports(source: string): string[] {
      const specifiers: string[] = [];
      const re = /(?:^|\n)\s*(?:import|export)(\s+type)?\s*([\s\S]*?)from\s*["']([^"']+)["']/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) {
        if (match[1]) continue;
        const names = (match[2] ?? "").replace(/[{}]/g, "").split(",").map((n) => n.trim())
          .filter(Boolean);
        if (names.length > 0 && names.every((n) => n.startsWith("type "))) continue;
        const specifier = match[3];
        if (specifier !== undefined) specifiers.push(specifier);
      }
      const bare = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
      while ((match = bare.exec(source)) !== null) {
        const specifier = match[1];
        if (specifier !== undefined) specifiers.push(specifier);
      }
      return specifiers;
    }

    const TARGET = "platform/compat/dynamic-import.ts";

    it("guards every distinct PLATFORM_UTILITY_PATHS client entry", () => {
      const utilsSource = read("html/utils.ts");
      if (utilsSource === null) throw new Error("src/html/utils.ts must exist");
      const guarded = new Set<string>();
      const re = /"\/_vf_modules\/_veryfront\/([^"]+)\.js"/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(utilsSource)) !== null) {
        guarded.add(`${match[1]}.ts`);
      }
      assertEquals(
        [...guarded].sort(),
        [...CLIENT_ENTRIES].sort(),
        "every distinct PLATFORM_UTILITY_PATHS target needs a CLIENT_ENTRIES reachability guard",
      );
    });

    for (const entry of CLIENT_ENTRIES) {
      it(`should not be reachable from ${entry}`, () => {
        const parent = new Map<string, string | null>([[entry, null]]);
        const queue = [entry];
        let found: string | null = null;

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (current === TARGET) {
            found = current;
            break;
          }
          const source = read(current);
          if (source === null) continue;
          for (const specifier of valueImports(source)) {
            const resolved = resolveSpecifier(specifier, current);
            if (resolved !== null && !parent.has(resolved)) {
              parent.set(resolved, current);
              queue.push(resolved);
            }
          }
        }

        let chain = "";
        if (found !== null) {
          const path: string[] = [];
          let cursor: string | null = found;
          while (cursor !== null) {
            path.unshift(cursor);
            cursor = parent.get(cursor) ?? null;
          }
          chain = `\n  ${path.join("\n  -> ")}`;
        }

        assertEquals(
          found,
          null,
          `client entry ${entry} value-imports dynamic-import.ts, whose new Function ` +
            `the page CSP blocks at runtime — hydration dies before first paint.` +
            `\nUsually a barrel import; import the defining module directly instead.${chain}`,
        );
      });
    }
  });
});
