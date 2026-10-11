import { fileURLToPath } from "node:url";
import { assertEquals } from "@std/assert";

Deno.test("YAML runtime bundle matches the frozen official browser entry", async () => {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--frozen",
      "-A",
      fileURLToPath(new URL("../scripts/prebundle.ts", import.meta.url)),
      "--check",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
});

Deno.test("YAML parsing succeeds with all host permissions denied", async () => {
  const source = `
    const { parseYamlSource } = await import(${
    JSON.stringify(new URL("./adapter.ts", import.meta.url).href)
  });
    let envDenied = false;
    try { Deno.env.get("LOG_TOKENS"); } catch (error) { envDenied = error instanceof Deno.errors.NotCapable; }
    if (!envDenied) throw new Error("Environment access must stay denied");
    const parsed = parseYamlSource(${
    JSON.stringify(["enabled: true", "items:", "  - scoped", ""].join(String.fromCharCode(10)))
  });
    console.log(JSON.stringify({ envDenied, parsed }));
  `;
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--frozen", "--cached-only", "--no-prompt", "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(5_000),
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(source));
  await writer.close();
  const output = await child.output();
  assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
  assertEquals(JSON.parse(new TextDecoder().decode(output.stdout)), {
    envDenied: true,
    parsed: { enabled: true, items: ["scoped"] },
  });
});
