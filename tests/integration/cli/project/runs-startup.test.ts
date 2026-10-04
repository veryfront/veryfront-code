import { assertEquals } from "#veryfront/testing/assert";
import { fileURLToPath } from "node:url";

Deno.test("canonical CLI entry preserves machine and human usage errors", async () => {
  const root = new URL("../../../../", import.meta.url);
  const coverage = Deno.env.get("VF_RUNS_CLI_COVERAGE_DIR");
  for (
    const { command, flags } of [
      { command: "project", flags: ["--ndjson"] },
      { command: "projects", flags: ["--ndjson"] },
      { command: "project", flags: [] },
    ]
  ) {
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        ...(coverage ? [`--coverage=${coverage}`] : []),
        "--frozen",
        "--allow-all",
        fileURLToPath(new URL("cli/main.ts", root)),
        command,
        "runs",
        "list",
        ...flags,
        "--query",
        "[]",
      ],
      cwd: fileURLToPath(root),
      env: { LOG_LEVEL: "INFO", VERYFRONT_NO_UPDATE_CHECK: "1", VF_DISABLE_LRU_INTERVAL: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 2, new TextDecoder().decode(result.stderr));
    if (!flags.length) {
      assertEquals(new TextDecoder().decode(result.stdout).trim(), "");
      assertEquals(new TextDecoder().decode(result.stderr).trim().length > 0, true);
      continue;
    }
    const lines = new TextDecoder().decode(result.stdout).trim().split("\n");
    if (flags[0] === "--ndjson") assertEquals(lines.length, 1);
    const envelope = JSON.parse(lines.join("\n"));
    assertEquals(envelope.success, false);
    assertEquals(envelope.command, "project runs");
    assertEquals(envelope.error.code, "USAGE_ERROR");
  }
});
