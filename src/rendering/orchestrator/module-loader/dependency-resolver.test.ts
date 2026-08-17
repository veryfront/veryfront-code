import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/index.ts";
import {
  type ResolvedModuleDependency,
  resolveModuleDependencies,
  rewriteResolvedDependencyImports,
} from "./dependency-resolver.ts";

async function withDependencyFixture<T>(
  files: Record<string, string>,
  test: (fixture: { projectDir: string }) => Promise<T>,
): Promise<T> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-module-deps-project-" });

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = join(projectDir, relativePath);
      await Deno.mkdir(dirname(absolutePath), { recursive: true });
      await Deno.writeTextFile(absolutePath, content);
    }

    return await test({ projectDir });
  } finally {
    await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
  }
}

// Every hand-built fixture below is a static `from "…"` span, so the helper
// stamps `isDynamic: false` instead of repeating it at each call site.
function withStaticSpan<T extends { full: string }>(
  source: string,
  dep: T,
): T & { start: number; end: number; isDynamic: false } {
  const start = source.indexOf(dep.full);
  return { ...dep, start, end: start + dep.full.length, isDynamic: false };
}

describe("module-loader/dependency-resolver", () => {
  it("fails closed when static import collection exceeds its bound", async () => {
    const adapter = await getLocalAdapter();
    const fileContent = Array.from(
      { length: 501 },
      (_, index) => `import value${index} from "@/value-${index}";`,
    ).join("\n");

    await assertRejects(
      () =>
        resolveModuleDependencies({
          adapter,
          fileContent,
          filePath: "/project/page.tsx",
          projectDir: "/project",
        }),
      RangeError,
      "more than 500 static alias imports",
    );
  });

  // Bounding only the static scan would leave the same allocation reachable
  // through the dynamic-import form, since both kinds are collected and
  // rewritten together.
  it("fails closed when dynamic import collection exceeds its bound", async () => {
    const adapter = await getLocalAdapter();
    const fileContent = Array.from(
      { length: 501 },
      (_, index) => `const value${index} = await import("@/value-${index}");`,
    ).join("\n");

    await assertRejects(
      () =>
        resolveModuleDependencies({
          adapter,
          fileContent,
          filePath: "/project/page.tsx",
          projectDir: "/project",
        }),
      RangeError,
      "more than 500 dynamic alias imports",
    );
  });

  it("fails closed when dynamic relative import collection exceeds its bound", async () => {
    const adapter = await getLocalAdapter();
    const fileContent = Array.from(
      { length: 501 },
      (_, index) => `const value${index} = await import("./value-${index}");`,
    ).join("\n");

    await assertRejects(
      () =>
        resolveModuleDependencies({
          adapter,
          fileContent,
          filePath: "/project/page.tsx",
          projectDir: "/project",
        }),
      RangeError,
      "more than 500 dynamic relative imports",
    );
  });

  it("fails closed when side-effect import collection exceeds its bound", async () => {
    const adapter = await getLocalAdapter();
    const fileContent = Array.from(
      { length: 501 },
      (_, index) => `import "./value-${index}";`,
    ).join("\n");

    await assertRejects(
      () =>
        resolveModuleDependencies({
          adapter,
          fileContent,
          filePath: "/project/page.tsx",
          projectDir: "/project",
        }),
      RangeError,
      "more than 500 side-effect relative imports",
    );
  });

  it("resolves and rewrites side-effect alias and relative imports", async () => {
    await withDependencyFixture(
      {
        "app/page.tsx": [
          `import "@/setup";`,
          `import "./local-setup";`,
          `export default function Page() { return null; }`,
        ].join("\n"),
        "components/setup.ts": `globalThis.aliasReady = true;`,
        "app/local-setup.ts": `globalThis.localReady = true;`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "app/page.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.length, 2);
        const rewritten = rewriteResolvedDependencyImports(
          fileContent,
          deps.map((dep, index) => ({ ...dep, depTempPath: `/tmp/setup-${index}.js` })),
        );
        assertStringIncludes(rewritten, `import "file:///tmp/setup-0.js";`);
        assertStringIncludes(rewritten, `import "file:///tmp/setup-1.js";`);
      },
    );
  });

  it("resolves side-effect imports after statements and keyword comments", async () => {
    await withDependencyFixture(
      {
        "app/page.tsx": [
          `const ready = true; import /* preload */ "@/setup";`,
          `import /* preload */ "./local-setup";`,
          `export default function Page() { return ready; }`,
        ].join("\n"),
        "components/setup.ts": `globalThis.aliasReady = true;`,
        "app/local-setup.ts": `globalThis.localReady = true;`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "app/page.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.map((dependency) => dependency.relativePath), [
          "setup",
          "./local-setup",
        ]);
      },
    );
  });

  it("does not resolve import-looking JSX display text", async () => {
    await withDependencyFixture(
      {
        "app/page.tsx": [
          `const label = "Example: ";`,
          `export default function Page() {`,
          `  return <code>{label}import "./example"</code>;`,
          `}`,
        ].join("\n"),
        "app/example.ts": `export const example = true;`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "app/page.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps, []);
        assertEquals(rewriteResolvedDependencyImports(fileContent, []), fileContent);
      },
    );
  });

  it("resolves alias and relative imports while ignoring already transformed file imports", async () => {
    await withDependencyFixture(
      {
        "app/page.tsx": [
          `import { Button } from "@/Button";`,
          `import { value } from "../lib/value";`,
          `import { cached } from "file:///tmp/cached.js";`,
          `export const page = Button + value + cached;`,
        ].join("\n"),
        "components/Button.tsx": `export const Button = "button";`,
        "lib/value.ts": `export const value = "value";`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "app/page.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.length, 2);
        assertStringIncludes(deps[0]?.depFilePath ?? "", "/components/Button.tsx");
        assertStringIncludes(deps[1]?.depFilePath ?? "", "/lib/value.ts");
      },
    );
  });

  it("warns only when a deprecated components alias fallback resolves", async () => {
    await withDependencyFixture(
      {
        "app/page.tsx": [
          `import { Root } from "@/Root";`,
          `import { LegacyPrefix } from "@/LegacyPrefix";`,
          `import { LegacyStrip } from "@/components/LegacyStrip";`,
          `export const page = Root + LegacyPrefix + LegacyStrip;`,
        ].join("\n"),
        "Root.ts": `export const Root = "root";`,
        "components/LegacyPrefix.ts": `export const LegacyPrefix = "prefix";`,
        "LegacyStrip.ts": `export const LegacyStrip = "strip";`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "app/page.tsx");
        const fileContent = await Deno.readTextFile(filePath);
        const records: LogEntry[] = [];
        const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));

        try {
          const deps = await resolveModuleDependencies({
            adapter,
            fileContent,
            filePath,
            projectDir,
          });
          assertEquals(deps.every((dependency) => dependency.depFilePath !== null), true);
        } finally {
          unsubscribe();
        }

        const warnings = records
          .filter((entry) =>
            entry.component === "module-loader" &&
            entry.level === "warn" &&
            entry.message ===
              "The @/ alias resolved through the deprecated components/ fallback. Update the import to match the project-relative file path."
          )
          .map((entry) => ({
            specifier: entry.context?.specifier,
            suggestedSpecifier: entry.context?.suggestedSpecifier,
          }))
          .sort((left, right) => String(left.specifier) < String(right.specifier) ? -1 : 1);

        assertEquals(warnings, [
          {
            specifier: "@/LegacyPrefix",
            suggestedSpecifier: "@/components/LegacyPrefix",
          },
          {
            specifier: "@/components/LegacyStrip",
            suggestedSpecifier: "@/LegacyStrip",
          },
        ]);
      },
    );
  });

  it("rewrites transformed dependency imports to file URLs", () => {
    const source = [
      `import { Button } from "@/Button";`,
      `import { value } from "../lib/value";`,
    ].join("\n");

    const rewritten = rewriteResolvedDependencyImports(source, [
      withStaticSpan(source, {
        full: `from "@/Button"`,
        path: "@/Button",
        relativePath: "Button",
        depFilePath: "/project/components/Button.tsx",
        depTempPath: "/tmp/components/Button.abc.js",
        isLocalLib: false,
      }),
      withStaticSpan(source, {
        full: `from "../lib/value"`,
        path: "../lib/value",
        relativePath: "../lib/value",
        depFilePath: "/project/lib/value.ts",
        depTempPath: "/tmp/lib/value.def.js",
        isLocalLib: false,
      }),
    ]);

    assertStringIncludes(rewritten, `from "file:///tmp/components/Button.abc.js"`);
    assertStringIncludes(rewritten, `from "file:///tmp/lib/value.def.js"`);
  });

  it("preserves encoded dependency-pin directory names in file URLs", () => {
    const source = `import { value } from "../lib/value";`;
    const rewritten = rewriteResolvedDependencyImports(source, [
      withStaticSpan(source, {
        full: `from "../lib/value"`,
        path: "../lib/value",
        relativePath: "../lib/value",
        depFilePath: "/project/lib/value.ts",
        depTempPath: "/tmp/_pins/on%3Asnapshot/lib/value.abc.js",
        isLocalLib: false,
      }),
    ]);

    assertStringIncludes(
      rewritten,
      `from "file:///tmp/_pins/on%253Asnapshot/lib/value.abc.js"`,
    );
  });

  it("rewrites the matched import instead of the same text in an earlier comment", async () => {
    await withDependencyFixture(
      {
        "app/page.tsx": [
          `// Previous example: from "@/Button"`,
          `import { Button } from "@/Button";`,
          `export const page = Button;`,
        ].join("\n"),
        "components/Button.tsx": `export const Button = "button";`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "app/page.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });
        const transformedDeps: Array<ResolvedModuleDependency & { depTempPath: string }> = deps
          .map((dep) => ({ ...dep, depTempPath: "/tmp/components/Button.abc.js" }));

        const rewritten = rewriteResolvedDependencyImports(fileContent, transformedDeps);

        assertStringIncludes(rewritten, `// Previous example: from "@/Button"`);
        assertStringIncludes(
          rewritten,
          `import { Button } from "file:///tmp/components/Button.abc.js";`,
        );
      },
    );
  });
});

describe("module-loader/dependency-resolver: dynamic imports", () => {
  it("resolves a dynamic @/ alias import inside getServerData", async () => {
    await withDependencyFixture(
      {
        "pages/test/e.tsx": [
          `export async function getServerData() {`,
          `  const { hashOf } = await import("@/lib/uses-crypto");`,
          `  return { props: { hashed: hashOf("hello") } };`,
          `}`,
        ].join("\n"),
        "lib/uses-crypto.ts": `export const hashOf = (v) => v;`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "pages/test/e.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.length, 1);
        assertEquals(deps[0]?.isDynamic, true);
        assertEquals(deps[0]?.depFilePath, join(projectDir, "lib/uses-crypto.ts"));

        // The rewrite must replace only the quoted specifier, leaving
        // `await import(...)` intact.
        const rewritten = rewriteResolvedDependencyImports(fileContent, [
          { ...deps[0]!, depTempPath: "/tmp/out/lib/uses-crypto.abc.js" },
        ]);
        assertStringIncludes(
          rewritten,
          `await import("file:///tmp/out/lib/uses-crypto.abc.js")`,
        );
      },
    );
  });

  it("resolves a dynamic relative import that carries a .ts extension", async () => {
    await withDependencyFixture(
      {
        "pages/test/f.tsx": [
          `export async function getServerData() {`,
          `  const { hashOf } = await import("../../lib/uses-crypto.ts");`,
          `  return { props: { hashed: hashOf("hello") } };`,
          `}`,
        ].join("\n"),
        "lib/uses-crypto.ts": `export const hashOf = (v) => v;`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "pages/test/f.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.length, 1);
        assertEquals(deps[0]?.isDynamic, true);
        assertEquals(deps[0]?.depFilePath, join(projectDir, "lib/uses-crypto.ts"));
      },
    );
  });

  it("still resolves static imports alongside dynamic ones", async () => {
    await withDependencyFixture(
      {
        "pages/test/mixed.tsx": [
          `import { Button } from "@/Button";`,
          `export async function getServerData() {`,
          `  const { value } = await import("../../lib/value");`,
          `  return { props: { value } };`,
          `}`,
          `export default () => Button;`,
        ].join("\n"),
        "components/Button.tsx": `export const Button = "button";`,
        "lib/value.ts": `export const value = "value";`,
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "pages/test/mixed.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.length, 2);
        assertEquals(deps.filter((d) => d.isDynamic).length, 1);
        assertEquals(deps.filter((d) => !d.isDynamic).length, 1);
        assertEquals(deps.every((d) => d.depFilePath !== null), true);
      },
    );
  });

  it("ignores a dynamic import whose specifier is not a literal", async () => {
    await withDependencyFixture(
      {
        "pages/test/dyn.tsx": [
          `export async function getServerData(ctx) {`,
          `  const mod = await import(ctx.query.get("mod"));`,
          `  return { props: { mod } };`,
          `}`,
        ].join("\n"),
      },
      async ({ projectDir }) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "pages/test/dyn.tsx");
        const fileContent = await Deno.readTextFile(filePath);

        const deps = await resolveModuleDependencies({
          adapter,
          fileContent,
          filePath,
          projectDir,
        });

        assertEquals(deps.length, 0);
      },
    );
  });
});
