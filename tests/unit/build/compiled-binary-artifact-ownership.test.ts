import { assert, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";

const childProgram = `
  const helper = await import("./tests/integration/compiled-binary-e2e.test-helpers.ts");
  if (helper.MANAGES_BINARY_ARTIFACT) {
    throw new Error("caller-provided binary was classified as test-owned");
  }
  await helper.ensureBinaryCompiled();
  await helper.cleanupCompiledBinaryArtifacts();
`;

Deno.test("compiled-binary helpers preserve a caller-provided binary", async () => {
  const binaryPath = await Deno.makeTempFile({
    prefix: "veryfront-caller-binary-",
  });

  try {
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["eval", childProgram],
      cwd: Deno.cwd(),
      clearEnv: true,
      env: {
        ...Deno.env.toObject(),
        VERYFRONT_BINARY: binaryPath,
        VERYFRONT_BINARY_FRESH: "0",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(result.stderr);

    assert(result.success, `helper subprocess failed: ${stderr}`);
    assert(
      await exists(binaryPath),
      "cleanup must not delete a caller-provided binary",
    );
    assertStringIncludes(
      new TextDecoder().decode(result.stdout),
      "Using caller-provided binary",
      "the helper should report that it reused the configured artifact",
    );
  } finally {
    if (await exists(binaryPath)) await Deno.remove(binaryPath);
  }
});
