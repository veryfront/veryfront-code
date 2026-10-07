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

Deno.test("NDJSON establishes machine output before full CLI startup diagnostics", async () => {
  const root = new URL("../../../", import.meta.url);
  const entry = new URL("cli/main.ts", root);
  const source = await Deno.readTextFile(entry);
  const startup = 'await import("veryfront/platform/esbuild-init");';
  let copy: { readonly path: string; readonly cleanup: () => Promise<void> } | undefined;
  try {
    // Source runs do not extract a compiled VFS binary. Emit the same logger
    // diagnostic at the real initialization boundary to exercise entry ordering.
    const patched = source.replace(
      startup,
      `
const { serverLogger } = await import("#veryfront/utils/logger/logger.ts");
serverLogger.info("[esbuild] Extracted binary from VFS");
${startup}`,
    );
    assertEquals(patched !== source, true, "CLI startup diagnostic boundary must exist.");
    copy = await createIsolatedCliCopy(root, basename(fileURLToPath(entry)), patched);
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--config=${fileURLToPath(new URL("deno.json", root))}`,
        "--frozen",
        "--allow-all",
        copy.path,
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
    const otherCommand = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--config=${fileURLToPath(new URL("deno.json", root))}`,
        "--frozen",
        "--allow-all",
        copy.path,
        "--version",
        "--ndjson",
      ],
      cwd: fileURLToPath(root),
      env: { LOG_LEVEL: "INFO", VERYFRONT_NO_UPDATE_CHECK: "1", VF_DISABLE_LRU_INTERVAL: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(otherCommand.code, 0);
    const human = new TextDecoder().decode(otherCommand.stdout);
    assertEquals(human.includes("[esbuild] Extracted binary from VFS"), true);
    assertEquals(human.includes("Veryfront CLI v"), true);
  } finally {
    await copy?.cleanup();
  }
});
