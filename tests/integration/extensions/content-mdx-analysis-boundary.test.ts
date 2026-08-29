import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const analysisUrl = import.meta.resolve("@veryfront/ext-content-mdx/analysis");

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
      args: ["info", "--json", analysisUrl],
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
    assertEquals(packages.has("micromark"), true);
    assertEquals(packages.has("parse5"), true);
  });

  it("analyzes in a Worker with no inherited host permissions", async () => {
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
  if (
    !Array.isArray(modules) || typeof npmPackages !== "object" ||
    npmPackages === null
  ) {
    return new Set();
  }
  const pending = modules.flatMap((module) => {
    const kind = objectProperty(module, "kind");
    const npmPackage = objectProperty(module, "npmPackage");
    return kind === "npm" && typeof npmPackage === "string" ? [npmPackage] : [];
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
