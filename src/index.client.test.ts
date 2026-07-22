import { assertEquals } from "#std/assert";

interface DenoDocNode {
  readonly kind: string;
  readonly name: string;
}

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
  return parsed.nodes
    .filter((node) => node.kind !== "moduleDoc")
    .map((node) => `${node.kind}:${node.name}`)
    .sort();
}

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
