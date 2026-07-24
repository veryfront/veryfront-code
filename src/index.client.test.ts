import { assertEquals } from "#std/assert";
import type { MDXFrontmatterValue as ClientFrontmatterValue } from "./index.client.ts";
import type { MDXFrontmatterValue as RootFrontmatterValue } from "./index.ts";

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
    args: ["doc", "--json", "--frozen", "--lock=deno.lock", path],
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
