import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { execPath, getOsType, runCommand } from "#veryfront/platform/compat/process.ts";
import { fromFileUrl, join } from "#veryfront/compat/path";

describe("compiled framework capture", () => {
  for (const selfExtracting of [false, true]) {
    it(`reads ${selfExtracting ? "native self-extracted" : "immutable embedded"} framework sources`, async () => {
      const fs = createFileSystem();
      const dir = await fs.makeTempDir();
      try {
        const binary = join(
          dir,
          getOsType() === "windows" ? "framework-capture.exe" : "framework-capture",
        );
        const root = fromFileUrl(new URL("../../../", import.meta.url));
        const compiled = await runCommand(execPath(), {
          args: [
            "compile",
            ...(selfExtracting ? ["--self-extracting"] : []),
            "--cached-only",
            "--no-check",
            "--allow-read",
            "--allow-env",
            "--include",
            "src/agent/identity-contracts.ts",
            "--output",
            binary,
            "tests/integration/transforms/fixtures/framework-capture-binary.ts",
          ],
          cwd: root,
          capture: true,
          timeoutMs: 120_000,
          maxOutputBytes: 16_384,
        });
        assertEquals(compiled.success, true, "fixture compilation must succeed");
        const executed = await runCommand(binary, {
          cwd: dir,
          capture: true,
          timeoutMs: 15_000,
          maxOutputBytes: 4096,
        });
        assertEquals(executed.success, true, "framework capture must succeed");
        assertStringIncludes(executed.stdout ?? "", "framework-capture-ok");
      } finally {
        await fs.remove(dir, { recursive: true });
      }
    });
  }
});
