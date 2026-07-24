import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { BabelParseOnlyParser } from "./parser-only.ts";

describe("BabelParseOnlyParser", () => {
  const parser = new BabelParseOnlyParser();

  it("preserves the full parser's TypeScript, JSX, and CommonJS behavior", async () => {
    const typedJsx = await parser.parse({
      code: "export const view: JSX.Element = <main />;",
      filePath: "view.tsx",
    });
    const commonJs = await parser.parse({
      code: "if (module.parent) return; module.exports = true;",
      filePath: "entry.cjs",
    });
    const decorated = await parser.parse({
      code: "class Store { @logged accessor value = 1; }",
      filePath: "store.ts",
    });

    assertEquals(typedJsx.type, "File");
    assertEquals(commonJs.type, "File");
    assertEquals(decorated.type, "File");
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
        read: await isDenied(() => Deno.readTextFile(${
      JSON.stringify(parserUrl)
    })),
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
