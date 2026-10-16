import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

it("starts a proxy project without local Cloud login or association mutation", async () => {
  const directory = await makeTempDirWithOptions();
  try {
    await Deno.writeTextFile(
      `${directory}/veryfront.config.js`,
      'export default { projectSlug: "proxy-project", fs: { type: "veryfront-api", veryfront: { proxyMode: true } } };\n',
    );
    // Initialize process-lifetime CLI services before the child test starts.
    // The test runner exits normally and flushes coverage, unlike eval + Deno.exit.
    const script = `
      import ${
      JSON.stringify(new URL("../../../../src/schemas/_test-setup.ts", import.meta.url).href)
    };
      import { devCommand } from ${
      JSON.stringify(new URL("../../../../cli/commands/dev/command.ts", import.meta.url).href)
    };
      import { getConnectedLocalRuntime } from ${
      JSON.stringify(
        new URL("../../../../src/agent/ag-ui/connected-local-runtime.ts", import.meta.url).href,
      )
    };
      import { deleteEnv } from "#cli/process-env";
      import { ensureCliBundlerContracts } from ${
      JSON.stringify(new URL("../../../../cli/shared/default-contracts.ts", import.meta.url).href)
    };
      await ensureCliBundlerContracts();
      for (const key of ["VERYFRONT_API_TOKEN", "VERYFRONT_PROJECT_SLUG", "VERYFRONT_PROJECT_ID", "TENANT_PROJECT_SLUG", "TENANT_PROJECT_ID"]) deleteEnv(key);
      const server = await devCommand({ projectDir: ${
      JSON.stringify(directory)
    }, port: 0, demoMode: true, hmr: false });
      const connectedRuntime = getConnectedLocalRuntime();
      const hasAssociation = await Deno.stat(${
      JSON.stringify(`${directory}/veryfront.json`)
    }).then(() => true, () => false);
      await server.stop();
      Deno.test("proxy startup preserves the local connection state", () => {
        if (connectedRuntime !== undefined) throw new Error("Proxy started a connected local runtime");
        if (hasAssociation) throw new Error("Proxy mutated the project association");
      });
    `;
    const scriptPath = `${directory}/proxy-startup.ts`;
    await Deno.writeTextFile(scriptPath, script);
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--no-check",
        "--allow-all",
        "--config=deno.json",
        ...(Deno.env.get("DENO_COVERAGE_DIR") ? ["--coverage-raw-data-only"] : []),
        scriptPath,
      ],
      cwd: new URL("../../../..", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
