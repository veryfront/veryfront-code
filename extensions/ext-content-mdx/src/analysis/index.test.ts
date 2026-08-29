import { assert, assertEquals, assertLess, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import { analyzeContent, type ContentAnalysisResult } from "./index.ts";

function summarize(value: string, result: ContentAnalysisResult): unknown {
  assert(result.kind === "document");
  return {
    rendered: result.renderedRanges.map((range) =>
      value.slice(range.start.offset, range.end.offset)
    ),
    destinations: result.destinations.map((destination) => ({
      kind: destination.kind,
      rawValue: destination.rawValue,
      source: value.slice(
        destination.range.start.offset,
        destination.range.end.offset,
      ),
      offset: destination.range.start.offset,
      line: destination.range.start.line,
      column: destination.range.start.column,
      syntax: destination.syntax,
    })),
  };
}

describe("content analysis package boundary", () => {
  it("exposes Markdown destination analysis without the extension runtime", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `
          import { analyzeContent } from "@veryfront/ext-content-mdx/analysis";
          const result = await analyzeContent({
            value: "[Guide](../guides/start.md)",
            syntax: "markdown",
          });
          console.log(JSON.stringify(result));
        `,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(
      output.success,
      true,
      new TextDecoder().decode(output.stderr),
    );
    assertEquals(
      JSON.parse(new TextDecoder().decode(output.stdout)),
      {
        kind: "document",
        renderedRanges: [{
          start: { offset: 1, line: 1, column: 2 },
          end: { offset: 6, line: 1, column: 7 },
        }],
        destinations: [{
          kind: "markdown-link",
          rawValue: "../guides/start.md",
          range: {
            start: { offset: 8, line: 1, column: 9 },
            end: { offset: 26, line: 1, column: 27 },
          },
          syntax: "markdown",
        }],
      },
    );
  });

  it("keeps compilation, rendering, traversal, generation, and debug out of its graph", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "info",
        "--json",
        new URL("./index.ts", import.meta.url).href,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(
      output.success,
      true,
      new TextDecoder().decode(output.stderr),
    );
    const info: unknown = JSON.parse(new TextDecoder().decode(output.stdout));
    const graph = moduleSpecifiers(info).join("\n");
    const packages = reachableNpmPackageNames(info);

    assertEquals(graph.includes("ext-content-mdx/src/index.ts"), false);
    assertEquals(packages.has("@mdx-js/mdx"), false);
    assertEquals(packages.has("@mdx-js/react"), false);
    assertEquals(packages.has("remark-rehype"), false);
    assertEquals(packages.has("rehype-stringify"), false);
    assertEquals(packages.has("@babel/traverse"), false);
    assertEquals(packages.has("@babel/generator"), false);
    // micromark declares `debug` for its development entry, but the production
    // module graph must not load that environment-sensitive module.
    assertEquals(graph.includes("/debug"), false);
    assertEquals(packages.has("@babel/parser"), true);
  });

  it("analyzes in a Worker with no inherited host permissions", async () => {
    const analysisUrl = new URL("./index.ts", import.meta.url).href;
    const workerSource = `
      import { analyzeContent } from ${JSON.stringify(analysisUrl)};
      const [markdown, mdx] = await Promise.all([
        analyzeContent({ value: "[Guide](../guide.md)", syntax: "markdown" }),
        analyzeContent({ value: '<Card href={"../guide.md"} />', syntax: "mdx" }),
      ]);
      async function isDenied(operation) {
        try {
          await operation();
          return false;
        } catch (error) {
          return error instanceof Deno.errors.NotCapable;
        }
      }
      globalThis.postMessage({
        results: [markdown.kind, mdx.kind],
        denied: {
          env: await isDenied(() => Deno.env.get("CONTENT_ANALYSIS_TEST")),
          read: await isDenied(() => Deno.readTextFile(${JSON.stringify(analysisUrl)})),
          net: await isDenied(() => fetch("http://127.0.0.1:9/")),
          run: await isDenied(() => new Deno.Command(Deno.execPath()).output()),
          ffi: await isDenied(() => Deno.dlopen("missing", {})),
        },
      });
    `;
    const workerUrl = URL.createObjectURL(
      new Blob([workerSource], { type: "text/javascript" }),
    );
    const workerOptions: WorkerOptions & {
      deno: { permissions: "none" };
    } = {
      type: "module",
      deno: { permissions: "none" },
    };
    const worker = new Worker(workerUrl, workerOptions);

    try {
      assertEquals(await receiveWorkerMessage(worker), {
        results: ["document", "document"],
        denied: {
          env: true,
          read: true,
          net: true,
          run: true,
          ffi: true,
        },
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    }
  });
});

describe("analyzeContent Markdown", () => {
  it("returns links, images, and only used reference definitions", async () => {
    const value = "[Guide](../guides/start.md) ![Logo](../assets/logo.png)\n\n" +
      "[API][api]\n\n[api]: ../reference/api.md\n[unused]: ../unused.md";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assertEquals(summarize(value, result), {
      rendered: ["Guide", " ", "Logo", "API"],
      destinations: [
        {
          kind: "markdown-link",
          rawValue: "../guides/start.md",
          source: "../guides/start.md",
          offset: 8,
          line: 1,
          column: 9,
          syntax: "markdown",
        },
        {
          kind: "markdown-image",
          rawValue: "../assets/logo.png",
          source: "../assets/logo.png",
          offset: 36,
          line: 1,
          column: 37,
          syntax: "markdown",
        },
        {
          kind: "markdown-definition",
          rawValue: "../reference/api.md",
          source: "../reference/api.md",
          offset: 76,
          line: 5,
          column: 8,
          syntax: "markdown",
        },
      ],
    });
  });

  it("distinguishes URI and GFM bare autolinks from Markdown links", async () => {
    const value = "<https://veryfront.com/docs/code/guides/start> and " +
      "https://veryfront.com/docs/code/reference/api.";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assertEquals(summarize(value, result), {
      rendered: [
        "https://veryfront.com/docs/code/guides/start",
        " and ",
        "https://veryfront.com/docs/code/reference/api",
        ".",
      ],
      destinations: [
        {
          kind: "autolink",
          rawValue: "https://veryfront.com/docs/code/guides/start",
          source: "https://veryfront.com/docs/code/guides/start",
          offset: 1,
          line: 1,
          column: 2,
          syntax: "autolink",
        },
        {
          kind: "autolink",
          rawValue: "https://veryfront.com/docs/code/reference/api",
          source: "https://veryfront.com/docs/code/reference/api",
          offset: 51,
          line: 1,
          column: 52,
          syntax: "autolink",
        },
      ],
    });
  });

  it("excludes frontmatter and code from rendered ranges", async () => {
    const value = "---\ntitle: https://frontmatter.invalid\n---\n\n" +
      "Visible `https://inline.invalid`\n\n" +
      "```ts\nhttps://fence.invalid\n```";

    const result = await analyzeContent({
      value,
      syntax: "markdown",
      frontmatter: true,
    });

    assertEquals(summarize(value, result), {
      rendered: ["Visible "],
      destinations: [],
    });
  });

  it("reads destination attributes only inside parser-reported raw HTML", async () => {
    const value = '<a href="../guides/start.md">Guide</a>\n\n' +
      '<img src="../assets/logo.png">\n\n' +
      "<form action='../submit'>x</form>";

    const result = await analyzeContent({ value, syntax: "markdown" });

    assertEquals(summarize(value, result), {
      rendered: ["Guide", "x"],
      destinations: [
        {
          kind: "html-attribute",
          rawValue: "../guides/start.md",
          source: "../guides/start.md",
          offset: 9,
          line: 1,
          column: 10,
          syntax: "html-attribute",
        },
        {
          kind: "html-attribute",
          rawValue: "../assets/logo.png",
          source: "../assets/logo.png",
          offset: 50,
          line: 3,
          column: 11,
          syntax: "html-attribute",
        },
        {
          kind: "html-attribute",
          rawValue: "../submit",
          source: "../submit",
          offset: 86,
          line: 5,
          column: 15,
          syntax: "html-attribute",
        },
      ],
    });
  });

  it("preserves authored Markdown escapes in destination values and ranges", async () => {
    const value = String.raw`[Guide](../guides/a\)b.md)`;

    const result = await analyzeContent({ value, syntax: "markdown" });

    assertEquals(summarize(value, result), {
      rendered: ["Guide"],
      destinations: [{
        kind: "markdown-link",
        rawValue: String.raw`../guides/a\)b.md`,
        source: String.raw`../guides/a\)b.md`,
        offset: 8,
        line: 1,
        column: 9,
        syntax: "markdown",
      }],
    });
  });
});

describe("analyzeContent MDX", () => {
  it("keeps balanced invalid JavaScript as prose only in Markdown mode", async () => {
    const value = "Before {const =} after";

    const markdown = await analyzeContent({ value, syntax: "markdown" });
    const mdx = await analyzeContent({
      value,
      syntax: "mdx",
      filePath: "docs/example.mdx",
    });

    assertEquals(summarize(value, markdown), {
      rendered: [value],
      destinations: [],
    });
    assert(mdx.kind === "syntax-error");
    assertEquals(mdx.diagnostic.range.start, {
      offset: 8,
      line: 1,
      column: 9,
    });
    assertStringIncludes(mdx.diagnostic.message, "Unexpected");
  });

  it("returns quoted and expression-backed static JSX destinations", async () => {
    const value = '<Card href="../a.md" src={"../b.png"} ' +
      "action={'../c'} data-template={`../d`} dynamic={target}>" +
      "Visible</Card>";

    const result = await analyzeContent({
      value,
      syntax: "mdx",
      filePath: "docs/example.mdx",
    });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => ({
        kind: destination.kind,
        rawValue: destination.rawValue,
        source: value.slice(
          destination.range.start.offset,
          destination.range.end.offset,
        ),
        syntax: destination.syntax,
      })),
      [
        {
          kind: "mdx-jsx-attribute",
          rawValue: "../a.md",
          source: "../a.md",
          syntax: "html-attribute",
        },
        {
          kind: "mdx-jsx-attribute",
          rawValue: "../b.png",
          source: "../b.png",
          syntax: "javascript-string",
        },
        {
          kind: "mdx-jsx-attribute",
          rawValue: "../c",
          source: "../c",
          syntax: "javascript-string",
        },
      ],
    );
    assertEquals(
      result.renderedRanges.map((range) => value.slice(range.start.offset, range.end.offset)),
      ["Visible"],
    );
  });

  it("finds static attributes on JSX nested inside an expression", async () => {
    const value = '<Card child={<Link href="../nested.md" />} />';

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => ({
        kind: destination.kind,
        rawValue: destination.rawValue,
      })),
      [{ kind: "mdx-jsx-attribute", rawValue: "../nested.md" }],
    );
  });

  it("returns positioned diagnostics for malformed MDX structure and ESM", async () => {
    const mismatched = await analyzeContent({
      value: "<Card>text</Panel>",
      syntax: "mdx",
    });
    const invalidEsm = await analyzeContent({
      value: "export const value = ;\n\n# Heading",
      syntax: "mdx",
    });

    assert(mismatched.kind === "syntax-error");
    assertEquals(mismatched.diagnostic.range.start.line, 1);
    assertEquals(mismatched.diagnostic.range.start.column, 11);
    assertStringIncludes(mismatched.diagnostic.message, "closing tag");
    assert(invalidEsm.kind === "syntax-error");
    assertEquals(invalidEsm.diagnostic.range.start, {
      offset: 21,
      line: 1,
      column: 22,
    });
    assertStringIncludes(invalidEsm.diagnostic.message, "import/exports");
  });

  it("analyzes 4,000 nested JSX children without recursive parsing", async () => {
    const depth = 4_000;
    const value = "<a data-ok={" +
      "<A>{".repeat(depth) +
      "value" +
      "}</A>".repeat(depth) +
      '} href="../architecture/deep-jsx.md">ok</a>';
    const startedAt = performance.now();

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../architecture/deep-jsx.md"],
    );
    assertLess(performance.now() - startedAt, 2_000);
  });

  it("analyzes 1,600 nested JSX attribute expressions without fallback", async () => {
    const depth = 1_600;
    const value = "<a data-ok={" +
      "<A value={".repeat(depth) +
      "null" +
      "} />".repeat(depth) +
      '} href="../architecture/deep-jsx-attributes.md">ok</a>';
    const startedAt = performance.now();

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "document");
    assertEquals(
      result.destinations.map((destination) => destination.rawValue),
      ["../architecture/deep-jsx-attributes.md"],
    );
    assertLess(performance.now() - startedAt, 2_000);
  });

  it("rejects malformed nested JSX in parser-bounded time", async () => {
    const depth = 2_000;
    const value = "<a data-ok={" +
      "<A value={".repeat(depth) +
      "null}".repeat(depth) + ">";
    const startedAt = performance.now();

    const result = await analyzeContent({ value, syntax: "mdx" });

    assert(result.kind === "syntax-error");
    assertLess(performance.now() - startedAt, 2_000);
  });
});

function objectProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function moduleSpecifiers(info: unknown): string[] {
  const modules = objectProperty(info, "modules");
  if (!Array.isArray(modules)) return [];
  return modules.flatMap((module) => {
    const specifier = objectProperty(module, "specifier");
    return typeof specifier === "string" ? [specifier] : [];
  });
}

function reachableNpmPackageNames(info: unknown): Set<string> {
  const modules = objectProperty(info, "modules");
  const npmPackages = objectProperty(info, "npmPackages");
  if (!Array.isArray(modules) || typeof npmPackages !== "object" || npmPackages === null) {
    return new Set();
  }
  const pending = modules.flatMap((module) => {
    const kind = objectProperty(module, "kind");
    const npmPackage = objectProperty(module, "npmPackage");
    return kind === "npm" && typeof npmPackage === "string"
      ? [npmPackage]
      : [];
  });
  const visited = new Set<string>();
  const names = new Set<string>();

  while (pending.length > 0) {
    const packageId = pending.pop();
    if (packageId === undefined || visited.has(packageId)) continue;
    visited.add(packageId);
    const npmPackage = objectProperty(npmPackages, packageId);
    const name = objectProperty(npmPackage, "name");
    if (typeof name === "string") names.add(name);
    const dependencies = objectProperty(npmPackage, "dependencies");
    if (Array.isArray(dependencies)) {
      for (const dependency of dependencies) {
        if (typeof dependency === "string") pending.push(dependency);
      }
    }
  }
  return names;
}

function receiveWorkerMessage(worker: Worker): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Permissionless content-analysis Worker timed out"));
    }, 5_000);
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      resolve(event.data);
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      reject(event.error ?? new Error(event.message));
    };
  });
}
