import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

// The framework is portable; this Cloud transport intentionally requires Node TLS PSK.
if ("Deno" in globalThis || "Bun" in globalThis) {
  it("verifies trusted runtime process separation on the supported Node transport", {
    timeout: 60_000,
  }, async () => {
    const root = new URL("../../../", import.meta.url);
    const child = spawn("node", [
      "--import",
      fileURLToPath(new URL("tests/node/resolver.mjs", root)),
      "--test",
      fileURLToPath(import.meta.url),
    ], {
      cwd: fileURLToPath(root),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const result = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const timer = setTimeout(() => child.kill(), 55_000);
    try {
      assertEquals(await result, 0, output);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      await result;
    }
  });
} else {
  const { runNativeTrustedScenario } = await import("./fixtures/trusted-runtime-scenario.ts");
  describe("trusted hosted native execution", () => {
    for (const mode of ["complete", "cancel", "crash", "startup-failure", "denied"] as const) {
      it(
        `preserves the trust boundary and original-work ownership on ${mode}`,
        { timeout: 30_000 },
        () => runNativeTrustedScenario(mode),
      );
    }
  });
}
