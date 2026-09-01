import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { BabelParseOnlyParser } from "./parser-only.ts";

describe("BabelParseOnlyParser", () => {
  const parser = new BabelParseOnlyParser();

  it("preserves the full parser's TypeScript, JSX, and CommonJS behavior", async () => {
    const typedJsx = await parser.parse({
      code: "export const view: JSX.Element = <main />;",
      filePath: "view.tsx",
    });
    const commonJs = await Promise.all(
      ["entry.cjs", "entry.js"].map((filePath) =>
        parser.parse({
          code: "if (module.parent) return; module.exports = true;",
          filePath,
        })
      ),
    );
    const decorated = await parser.parse({
      code: "class Store { @logged accessor value = 1; }",
      filePath: "store.ts",
    });

    assertEquals(typedJsx.type, "File");
    assertEquals(commonJs.map((ast) => ast.type), ["File", "File"]);
    assertEquals(decorated.type, "File");
  });

  it("parses compiled JSX under a Markdown or MDX path", async () => {
    // Markdown and MDX reach the parser as compiled JSX. Choosing the Babel
    // plugins from the authored extension would leave JSX off and the markup
    // would parse as a regular expression.
    const compiled = "export default function MDXContent() { return <h1>Title</h1>; }";

    const parsed = await Promise.all(
      ["page.mdx", "page.md", "page.MDX"].map((filePath) =>
        parser.parse({ code: compiled, filePath })
      ),
    );

    assertEquals(parsed.map((ast) => ast.type), ["File", "File", "File"]);
  });

  it("uses the original grammar for embedded framework source suffixes", async () => {
    const typedJsx = await parser.parse({
      code: "export const view: JSX.Element = <main />;",
      filePath: "tooltip.tsx.src",
    });
    const typeAssertion = await parser.parse({
      code: "const value = <string> input;",
      filePath: "helper.ts.src",
    });
    const commonJs = await parser.parse({
      code: "if (module.parent) return; module.exports = true;",
      filePath: "entry.js.src",
    });

    assertEquals([typedJsx.type, typeAssertion.type, commonJs.type], ["File", "File", "File"]);
  });

  it("keeps `<T>x` a type assertion for a `.ts` path", async () => {
    const asserted = await parser.parse({
      code: "const value = <string> input;",
      filePath: "module.ts",
    });

    assertEquals(asserted.type, "File");
  });

  it("supports an explicit JavaScript-only grammar for authored content", async () => {
    const jsx = await parser.parse({
      code: "const view = <main />;",
      filePath: "content.mdx",
      syntax: "javascript",
    });

    assertEquals(jsx.type, "File");
    await assertRejects(
      () =>
        parser.parse({
          code: "const value = input as string;",
          filePath: "content.mdx",
          syntax: "javascript",
        }),
      SyntaxError,
    );
  });

  it("parses legacy TypeScript parameter decorators", async () => {
    const ast = await parser.parse({
      code: "class Store { load(@inject dep: Dependency) { return dep; } }",
      filePath: "store.ts",
    });

    assertEquals(ast.type, "File");
  });

  it("parses legacy TypeScript decorator type arguments", async () => {
    const ast = await parser.parse({
      code: "@logged<string> export class Store {}",
      filePath: "store.ts",
    });

    assertEquals(ast.type, "File");
  });

  it("lets parser clients select one decorator dialect without a syntax retry", async () => {
    await assertRejects(
      () =>
        parser.parse({
          code: "class Store { load(@inject dep: Dependency) {} }",
          filePath: "store.ts",
          decoratorMode: "current",
        }),
      SyntaxError,
    );
  });

  it("preserves Babel syntax-error identity and location metadata", async () => {
    let thrown: unknown;
    try {
      await parser.parse({
        code: "export const value = ;",
        filePath: "veryfront.config.ts",
      });
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof SyntaxError);
    assertEquals(thrown.name, "SyntaxError");
    const location = (thrown as SyntaxError & {
      loc?: { line?: number; column?: number; index?: number };
    }).loc;
    assertEquals(location?.line, 1);
    assertEquals(location?.column, 21);
    assertEquals(location?.index, 21);
    assertStringIncludes(thrown.message, "Unexpected token");
  });

  it("has no traversal, generator, or debug modules in its runtime graph", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "info",
        "--json",
        new URL("./parser-only.ts", import.meta.url).href,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(
      output.success,
      true,
      new TextDecoder().decode(output.stderr),
    );
    const info = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      modules?: Array<{
        kind?: string;
        specifier?: string;
        npmPackage?: string;
      }>;
      npmPackages?: Record<string, {
        name?: string;
        dependencies?: string[];
      }>;
    };
    const graph = (info.modules ?? [])
      .map((module) => module.specifier ?? "")
      .join("\n");
    const reachablePackageNames = reachableNpmPackageNames(info);

    assertEquals(graph.includes("@babel/traverse"), false);
    assertEquals(graph.includes("@babel/generator"), false);
    assertEquals(reachablePackageNames.has("@babel/parser"), true);
    assertEquals(reachablePackageNames.has("@babel/traverse"), false);
    assertEquals(reachablePackageNames.has("@babel/generator"), false);
    assertEquals(reachablePackageNames.has("debug"), false);
  });

  it("loads and parses in a Deno Worker with no inherited permissions", async () => {
    const parserUrl = new URL("./parser-only.ts", import.meta.url).href;
    const workerSource = `
      import { BabelParseOnlyParser } from ${JSON.stringify(parserUrl)};

      const ast = await new BabelParseOnlyParser().parse({
        code: "export default defineConfig({ server: { port: 8080 } });",
        filePath: "veryfront.config.ts",
      });
      async function isDenied(operation) {
        try {
          await operation();
          return false;
        } catch (error) {
          return error instanceof Deno.errors.NotCapable;
        }
      }
      const deniedCapabilities = {
        env: await isDenied(() => Deno.env.get("BABEL_TYPES_8_BREAKING")),
        read: await isDenied(() => Deno.readTextFile(${JSON.stringify(parserUrl)})),
        net: await isDenied(() => fetch("http://127.0.0.1:9/")),
      };
      globalThis.postMessage({ astType: ast.type, deniedCapabilities });
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
      const result = await receiveWorkerMessage(worker);
      assertEquals(result, {
        astType: "File",
        deniedCapabilities: {
          env: true,
          read: true,
          net: true,
        },
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    }
  });
});

function reachableNpmPackageNames(info: {
  modules?: Array<{ kind?: string; npmPackage?: string }>;
  npmPackages?: Record<string, {
    name?: string;
    dependencies?: string[];
  }>;
}): Set<string> {
  const packages = info.npmPackages ?? {};
  const pending = (info.modules ?? [])
    .filter((module) => module.kind === "npm")
    .flatMap((module) => module.npmPackage ? [module.npmPackage] : []);
  const visited = new Set<string>();
  const names = new Set<string>();

  while (pending.length > 0) {
    const packageId = pending.pop()!;
    if (visited.has(packageId)) continue;
    visited.add(packageId);
    const npmPackage = packages[packageId];
    if (!npmPackage) continue;
    if (npmPackage.name) names.add(npmPackage.name);
    pending.push(...npmPackage.dependencies ?? []);
  }
  return names;
}

function receiveWorkerMessage(worker: Worker): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          "Permissionless parser Worker did not respond within 5 seconds",
        ),
      );
    }, 5_000);

    worker.onmessage = (event: MessageEvent<unknown>) => {
      clearTimeout(timeout);
      resolve(event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      clearTimeout(timeout);
      reject(
        new Error(`Permissionless parser Worker failed: ${event.message}`),
      );
    };
  });
}
