import { assertEquals } from "#std/assert";
import { fromFileUrl, join } from "#std/path";
import type { MDXFrontmatterValue as ClientFrontmatterValue } from "./index.client.ts";
import type { MDXFrontmatterValue as RootFrontmatterValue } from "./index.ts";

const REPOSITORY_ROOT = fromFileUrl(new URL("../", import.meta.url));

const rootFrontmatterValue: RootFrontmatterValue = {
  nested: [true, null, new Date("2026-07-23T00:00:00.000Z")],
};
const clientFrontmatterValue: ClientFrontmatterValue = rootFrontmatterValue;
void clientFrontmatterValue;

interface DenoDocNode {
  readonly kind: string;
  readonly name: string;
}

const expectedRootExports = [
  "function:apiNotFound",
  "function:apiRedirect",
  "function:badRequest",
  "function:createHandler",
  "function:createValidatedHandler",
  "function:createValidationError",
  "function:defineConfig",
  "function:defineConfigWithEnv",
  "function:forbidden",
  "function:getEnv",
  "function:json",
  "function:mergeConfigs",
  "function:notFound",
  "function:parseFormData",
  "function:parseJsonBody",
  "function:parseQueryParams",
  "function:redirect",
  "function:sanitizeData",
  "function:serverError",
  "function:startServer",
  "function:toNodeHandler",
  "function:unauthorized",
  "interface:APIContext",
  "interface:APIResponse",
  "interface:MDXFrontmatter",
  "interface:PageContext",
  "interface:PageWithData",
  "interface:ValidatedHandlerConfig",
  "interface:VeryfrontServer",
  "typeAlias:APIHandler",
  "typeAlias:APIRoute",
  "typeAlias:DataContext",
  "typeAlias:InferGetServerDataProps",
  "typeAlias:MDXFrontmatterValue",
  "typeAlias:StartServerOptions",
  "typeAlias:StaticPathsResult",
  "typeAlias:ValidatedHandlerFunction",
  "typeAlias:VeryfrontConfig",
  "typeAlias:VeryfrontHandler",
  "variable:CommonSchemas",
  "variable:INPUT_VALIDATION_FAILED",
] as const;

async function documentedExports(path: string): Promise<readonly string[]> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "doc",
      "--json",
      "--frozen",
      `--lock=${join(REPOSITORY_ROOT, "deno.lock")}`,
      join(REPOSITORY_ROOT, path),
    ],
    cwd: REPOSITORY_ROOT,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }

  const parsed = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    readonly nodes: readonly DenoDocNode[];
  };
  return [
    ...new Set(
      parsed.nodes
        .filter((node) => node.kind !== "moduleDoc")
        .map((node) => `${node.kind}:${node.name}`),
    ),
  ].sort();
}

async function browserBundle(path: string): Promise<string> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--frozen",
      "--platform=browser",
      "--no-check",
      join(REPOSITORY_ROOT, path),
    ],
    cwd: REPOSITORY_ROOT,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  return new TextDecoder().decode(output.stdout);
}

Deno.test("public root barrel preserves its supported export surface", async () => {
  assertEquals(await documentedExports("src/index.ts"), expectedRootExports);
});

Deno.test("client root barrel stays aligned with the public root contract", async () => {
  const root = await documentedExports("src/index.ts");
  const client = await documentedExports("src/index.client.ts");
  const serverOnly = new Set([
    "function:createHandler",
    "function:startServer",
    "function:toNodeHandler",
  ]);

  assertEquals(
    client,
    root.filter((entry) => !serverOnly.has(entry)),
  );
});

Deno.test("client root barrel does not instantiate broad server module graphs", async () => {
  const bundle = await browserBundle("src/index.client.ts");
  const nodeSpecifiers = [
    ...new Set(
      [...bundle.matchAll(/["'](node:[^"']+)["']/g)].map((match) => match[1]),
    ),
  ].sort();

  // `node:async_hooks` has a real framework browser polyfill. `node:buffer` is
  // the Node fallback for File; browsers select globalThis.File before it.
  assertEquals(nodeSpecifiers, ["node:async_hooks", "node:buffer"]);

  for (
    const serverOnlyMarker of [
      "src/data/data-fetcher.ts",
      "src/errors/error-registry.ts",
      "src/observability/instruments/memory-instruments.ts",
      "src/platform/adapters/runtime/node/",
      "src/routing/api/route-discovery.ts",
      "src/security/secure-fs.ts",
      "src/server/production-server.ts",
    ]
  ) {
    assertEquals(
      bundle.includes(serverOnlyMarker),
      false,
      `${serverOnlyMarker} must stay outside the client root graph`,
    );
  }
});
