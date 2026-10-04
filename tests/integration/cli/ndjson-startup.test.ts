import { assertEquals } from "#veryfront/testing/assert";
import { fileURLToPath } from "node:url";

Deno.test("NDJSON establishes machine output before full CLI startup diagnostics", async () => {
  const root = new URL("../../../", import.meta.url);
  const entry = new URL("cli/main.ts", root);
  const source = await Deno.readTextFile(entry);
  const startup = 'await import("veryfront/platform/esbuild-init");';
  const copy = await Deno.makeTempFile({
    dir: fileURLToPath(new URL("cli/", root)),
    suffix: ".ts",
  });
  try {
    // Source runs do not extract a compiled VFS binary. Emit the same logger
    // diagnostic at the real initialization boundary to exercise entry ordering.
    await Deno.writeTextFile(
      copy,
      source.replace(
        startup,
        `
const { serverLogger } = await import("#veryfront/utils/logger/logger.ts");
serverLogger.info("[esbuild] Extracted binary from VFS");
${startup}`,
      ),
    );
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--frozen",
        "--allow-all",
        copy,
        "project",
        "runs",
        "list",
        "--ndjson",
        "--query",
        "[]",
      ],
      cwd: fileURLToPath(root),
      env: { LOG_LEVEL: "INFO", VERYFRONT_NO_UPDATE_CHECK: "1", VF_DISABLE_LRU_INTERVAL: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 2, new TextDecoder().decode(result.stderr));
    const lines = new TextDecoder().decode(result.stdout).trim().split("\n");
    assertEquals(lines.length, 1);
    const envelope = JSON.parse(lines[0]!);
    assertEquals(envelope.success, false);
    assertEquals(envelope.command, "project runs");
    assertEquals(envelope.error.code, "USAGE_ERROR");
  } finally {
    await Deno.remove(copy);
  }
});
