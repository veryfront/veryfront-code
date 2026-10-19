import { assertEquals } from "#veryfront/testing/assert";
import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import { basename } from "#std/path/basename";
import { fileURLToPath } from "node:url";

async function createIsolatedCliCopy(
  root: URL,
  entryName: string,
  source: string,
): Promise<{ readonly path: string; readonly cleanup: () => Promise<void> }> {
  const cliRoot = fileURLToPath(new URL("cli/", root));
  const fixtureRoot = fileURLToPath(new URL("cli/__tests__/fixtures/startup-copies/", root));
  await Deno.mkdir(fixtureRoot, { recursive: true });
  const caseRoot = await makeTempDirWithOptions({ dir: fixtureRoot, prefix: "case-" });
  const tempDir = `${caseRoot}/cli`;
  await Deno.mkdir(tempDir);
  await Deno.symlink(fileURLToPath(new URL("deno.json", root)), `${caseRoot}/deno.json`);
  await Deno.symlink(fileURLToPath(new URL("src/", root)), `${caseRoot}/src`);

  for await (const entry of Deno.readDir(cliRoot)) {
    if (entry.name === "__tests__" || entry.name === "deno.json" || entry.name === entryName) {
      continue;
    }
    await Deno.symlink(`${cliRoot}/${entry.name}`, `${tempDir}/${entry.name}`);
  }

  const path = `${tempDir}/${entryName}`;
  await Deno.writeTextFile(path, source);
  return {
    path,
    cleanup: () => Deno.remove(caseRoot, { recursive: true }),
  };
}

Deno.test("MCP reserves stdout before cold compiled-asset diagnostics and logger refresh", async () => {
  const root = new URL("../../../", import.meta.url);
  const entry = new URL("cli/main.ts", root);
  const source = await Deno.readTextFile(entry);
  const startup = 'await import("veryfront/platform/esbuild-init");';
  const boundary = source.indexOf(startup);
  assertEquals(boundary >= 0, true);
  // Source runs do not extract a compiled VFS binary. Exercise the real CLI
  // bootstrap through exactly that boundary, then emit its actual logger call.
  const patched = source.slice(0, boundary) + `
const { serverLogger, refreshLoggerConfig } = await import("#veryfront/utils/logger/logger.ts");
serverLogger.info("[esbuild] Extracted binary from VFS");
refreshLoggerConfig();
serverLogger.debug("MCP startup debug diagnostic");
serverLogger.warn("MCP startup warning diagnostic");
Deno.exit(0);
`;
  const copy = await createIsolatedCliCopy(root, basename(fileURLToPath(entry)), patched);
  try {
    for (const command of ["mcp", "--version"]) {
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          `--config=${fileURLToPath(new URL("deno.json", root))}`,
          "--frozen",
          "--allow-all",
          copy.path,
          command,
        ],
        cwd: fileURLToPath(root),
        env: { LOG_LEVEL: "DEBUG", VERYFRONT_NO_UPDATE_CHECK: "1", VF_DISABLE_LRU_INTERVAL: "1" },
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);
      if (command === "mcp") {
        assertEquals(
          stdout,
          "",
          "MCP stdout must contain protocol records only, even before transport starts.",
        );
        assertEquals(stderr.includes("[esbuild] Extracted binary from VFS"), true);
        assertEquals(stderr.includes("MCP startup debug diagnostic"), true);
      } else {
        assertEquals(stdout.includes("[esbuild] Extracted binary from VFS"), true);
        assertEquals(stdout.includes("MCP startup debug diagnostic"), true);
      }
      assertEquals(stderr.includes("MCP startup warning diagnostic"), true);
    }
  } finally {
    await copy.cleanup();
  }
});
