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
    // CLI telemetry and signal handlers belong to the process lifetime.
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
      try {
        if (getConnectedLocalRuntime() !== undefined) throw new Error("Proxy started a connected local runtime");
        if (await Deno.stat(${
      JSON.stringify(`${directory}/veryfront.json`)
    }).then(() => true, () => false)) throw new Error("Proxy mutated the project association");
      } finally {
        await server.stop();
      }
      Deno.exit(0);
    `;
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--no-check", "--config=deno.json", script],
      cwd: new URL("../../../..", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
