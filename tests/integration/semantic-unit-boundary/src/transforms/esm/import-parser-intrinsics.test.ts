import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import {
  importParserInternals,
  parseLocalImports,
} from "#veryfront/transforms/esm/import-parser.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { rewriteBodyImports } from "#veryfront/transforms/mdx/compiler/import-rewriter.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";

function withStubContentProcessor(): { restore: () => void } {
  register("ContentProcessor", {
    compileMdx: (opts: Record<string, unknown>) => {
      const content = String(opts.content ?? "");
      const filePath = String(opts.filePath ?? "");
      const imports = content.split("\n").filter((line) => line.startsWith("import "));
      const body = rewriteBodyImports(imports.join("\n"), {
        filePath,
        target: (opts.target as "browser" | "server") ?? "server",
      });

      return Promise.resolve({
        compiledCode: `${body}\nexport default function MDXContent() { return null; }`,
        frontmatter: undefined,
      });
    },
    compileMarkdown: () =>
      Promise.resolve({
        compiledCode: `export default function MDContent() { return null; }`,
        frontmatter: undefined,
      }),
  });
  return { restore: () => unregister("ContentProcessor") };
}

async function withProject<T>(
  files: Record<string, string>,
  test: (projectDir: string) => Promise<T>,
): Promise<T> {
  const projectDir = await makeTempDir({ prefix: "vf-import-parser-intrinsics-" });
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = join(projectDir, relativePath);
      await Deno.mkdir(dirname(absolutePath), { recursive: true });
      await Deno.writeTextFile(absolutePath, content);
    }
    return await test(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
  }
}

it("keeps containment when Promise.all is poisoned", async () => {
  const originalPromiseAll = Promise.all;
  let canonicalizationCalls = 0;
  const adapter = {
    fs: {
      resolveFile: () => Promise.resolve("/project/child.tsx"),
      realPath: (path: string) => {
        canonicalizationCalls++;
        return Promise.resolve(path);
      },
    },
  } as unknown as RuntimeAdapter;
  try {
    Promise.all = ((values: Iterable<unknown>) => {
      if (canonicalizationCalls >= 2) {
        return Promise.resolve(["/", "/external/secret.tsx"]);
      }
      return Reflect.apply(originalPromiseAll, Promise, [[...values]]) as Promise<unknown[]>;
    }) as typeof Promise.all;

    const result = await parseLocalImports(
      'import Child from "@/child.tsx";',
      "/project/page.tsx",
      "/project",
      adapter,
    );

    assertEquals(
      result.imports.some((entry) => entry.absolutePath === "/external/secret.tsx"),
      false,
    );
  } finally {
    Promise.all = originalPromiseAll;
    await stopEsbuild();
  }
});

it("canonicalizes through an owned iterator", async () => {
  const originalIterator = Array.prototype[Symbol.iterator];
  const canonicalizationPromises: Promise<string>[] = [];
  const adapter = {
    fs: {
      resolveFile: () => Promise.resolve("/project/child.tsx"),
      realPath: (path: string) => {
        const promise = Promise.resolve(path);
        canonicalizationPromises[canonicalizationPromises.length] = promise;
        return promise;
      },
    },
  } as unknown as RuntimeAdapter;

  try {
    Array.prototype[Symbol.iterator] = function (this: unknown[]): ArrayIterator<unknown> {
      if (
        this.length === 2 &&
        this[0] === canonicalizationPromises[0] &&
        this[1] === canonicalizationPromises[1]
      ) {
        throw new Error("mutable array iterator reached canonicalization");
      }
      return Reflect.apply(originalIterator, this, []);
    };

    const result = await parseLocalImports(
      `import Child from "file:///project/child.tsx";\nexport default Child;`,
      "/project/page.tsx",
      "/project",
      adapter,
    );

    assertEquals(result.imports.length, 1);
  } finally {
    Array.prototype[Symbol.iterator] = originalIterator;
    await stopEsbuild();
  }
});

it("keeps containment when String prototype methods are poisoned", async () => {
  const originalReplaceAll = String.prototype.replaceAll;
  const originalStartsWith = String.prototype.startsWith;
  const adapter = {
    fs: {
      resolveFile: () => Promise.resolve("/external/secret.tsx"),
      realPath: (path: string) => Promise.resolve(path),
    },
  } as unknown as RuntimeAdapter;
  try {
    String.prototype.replaceAll = function (
      this: string,
      searchValue: string | RegExp,
      replaceValue: string,
    ): string {
      if (String(this).includes("secret.tsx") && searchValue === "\\") return "";
      return Reflect.apply(originalReplaceAll, this, [searchValue, replaceValue]);
    } as typeof String.prototype.replaceAll;
    String.prototype.startsWith = function (
      this: string,
      searchString: string,
      position?: number,
    ): boolean {
      if (
        String(this).includes("secret.tsx") &&
        (searchString === "../" || searchString === "/")
      ) return false;
      return Reflect.apply(originalStartsWith, this, [searchString, position]);
    };

    const result = await parseLocalImports(
      'import Secret from "@/../secret.tsx";',
      "/project/page.tsx",
      "/project",
      adapter,
    );

    assertEquals(result.imports, []);
  } finally {
    String.prototype.replaceAll = originalReplaceAll;
    String.prototype.startsWith = originalStartsWith;
    await stopEsbuild();
  }
});

it("keeps POSIX containment when Array.prototype.filter is poisoned", async () => {
  const originalFilter = Array.prototype.filter;
  const adapter = {
    fs: {
      resolveFile: () => Promise.resolve("/outside/secret.tsx"),
      realPath: (path: string) => Promise.resolve(path),
    },
  } as unknown as RuntimeAdapter;
  try {
    Array.prototype.filter = function <T>(
      this: T[],
      predicate: (value: T, index: number, array: T[]) => unknown,
      thisArg?: unknown,
    ): T[] {
      if (this[0] === "" && (this[1] === "project" || this[1] === "outside")) return [];
      return Reflect.apply(originalFilter, this, [predicate, thisArg]) as T[];
    };

    const result = await parseLocalImports(
      'import Secret from "@/secret.tsx";',
      "/project/page.tsx",
      "/project",
      adapter,
    );

    assertEquals(result.imports, []);
  } finally {
    Array.prototype.filter = originalFilter;
    await stopEsbuild();
  }
});

it("classifies MDX through the captured regexp intrinsic", async () => {
  const stub = withStubContentProcessor();
  const originalTest = RegExp.prototype.test;
  try {
    await withProject(
      {
        "pages/index.mdx": `import Child from "./Child.tsx";\n\n# Heading\n\n<Child />\n`,
        "pages/Child.tsx": `export default () => null;`,
      },
      async (projectDir) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "pages/index.mdx");
        const code = await Deno.readTextFile(filePath);

        try {
          RegExp.prototype.test = function (value: string): boolean {
            if (value === filePath) return false;
            return Reflect.apply(originalTest, this, [value]);
          };

          const result = await parseLocalImports(code, filePath, projectDir, adapter);
          assertEquals(result.missing, []);
          assertEquals(result.imports.length, 1);
          assertEquals(result.imports[0]?.rewriteSpecifier?.startsWith("file://"), true);
        } finally {
          RegExp.prototype.test = originalTest;
        }
      },
    );
  } finally {
    RegExp.prototype.test = originalTest;
    stub.restore();
    await stopEsbuild();
  }
});

it("redacts malformed file URLs through captured string intrinsics", () => {
  const originalLastIndexOf = String.prototype.lastIndexOf;
  const originalSlice = String.prototype.slice;
  const specifier = "file:///project/a%2Fb.tsx";
  try {
    String.prototype.lastIndexOf = function (searchString: string, position?: number): number {
      if (String(this) === specifier) return -1;
      return Reflect.apply(originalLastIndexOf, this, [searchString, position]);
    };
    String.prototype.slice = function (start?: number, end?: number): string {
      if (String(this) === specifier) return specifier;
      return Reflect.apply(originalSlice, this, [start, end]);
    };

    const authoredSpecifier = importParserInternals.toAuthoredSpecifier(
      null,
      specifier,
      "/project/page.tsx",
    );

    assertEquals(authoredSpecifier, "./a%2Fb.tsx");
  } finally {
    String.prototype.lastIndexOf = originalLastIndexOf;
    String.prototype.slice = originalSlice;
  }
});

// Regression: parse results were recorded through the live
// Array.prototype.push, so tenant code that replaced it to ignore entries
// carrying a rewriteSpecifier silently dropped an approved dependency from
// localImports; the validator then produced no bound read and no rewrite
// entry for the compiled parent's original file:// import.
it("records contained imports through the captured array intrinsic", async () => {
  const stub = withStubContentProcessor();
  const originalPush = Array.prototype.push;
  try {
    await withProject(
      {
        "pages/index.mdx": `import Child from "./Child.tsx";\n\n<Child />\n`,
        "pages/Child.tsx": `export default () => null;`,
      },
      async (projectDir) => {
        const adapter = await getLocalAdapter();
        const filePath = join(projectDir, "pages/index.mdx");
        const code = await Deno.readTextFile(filePath);

        let result: Awaited<ReturnType<typeof parseLocalImports>> | undefined;
        try {
          Array.prototype.push = function (this: unknown[], ...values: unknown[]): number {
            const [first] = values;
            if (typeof first === "object" && first !== null && "rewriteSpecifier" in first) {
              return this.length;
            }
            return Reflect.apply(originalPush, this, values) as number;
          };
          result = await parseLocalImports(code, filePath, projectDir, adapter);
        } finally {
          Array.prototype.push = originalPush;
        }

        assertEquals(result?.missing.length, 0);
        assertEquals(
          result?.imports.length,
          1,
          "a poisoned Array.prototype.push must not drop an approved dependency",
        );
        assertEquals(
          result?.imports[0]?.rewriteSpecifier?.startsWith("file://"),
          true,
          "the recorded entry must keep its compiled file URL for the final rewrite",
        );
      },
    );
  } finally {
    Array.prototype.push = originalPush;
    stub.restore();
    await stopEsbuild();
  }
});

it("walks parsed imports without inherited array iteration", async () => {
  const originalIterator = Array.prototype[Symbol.iterator];
  const adapter = {
    fs: {
      symlinkSemantics: "none",
      resolveFile: () => Promise.resolve("/project/child.tsx"),
    },
  } as unknown as RuntimeAdapter;

  try {
    Array.prototype[Symbol.iterator] = function (this: unknown[]): ArrayIterator<unknown> {
      const first = this[0];
      if (
        this.length > 0 &&
        typeof first === "object" &&
        first !== null &&
        Object.prototype.hasOwnProperty.call(first, "n")
      ) {
        return Reflect.apply(originalIterator, [], []);
      }
      return Reflect.apply(originalIterator, this, []);
    };

    const result = await parseLocalImports(
      `import Child from "file:///project/child.tsx";\nexport default Child;`,
      "/project/page.tsx",
      "/project",
      adapter,
    );

    assertEquals(result.imports.length, 1);
  } finally {
    Array.prototype[Symbol.iterator] = originalIterator;
    await stopEsbuild();
  }
});
