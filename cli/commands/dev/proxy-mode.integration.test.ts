import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#cli/process-env";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { getConnectedLocalRuntime } from "#veryfront/agent/ag-ui/connected-local-runtime.ts";
import { devCommand } from "./command.ts";

it("starts a proxy project without local Cloud login or association mutation", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const directory = await Deno.makeTempDir();
  const keys = [
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
    "TENANT_PROJECT_SLUG",
    "TENANT_PROJECT_ID",
  ];
  const saved = keys.map(getEnv);
  let server: Awaited<ReturnType<typeof devCommand>> | undefined;
  try {
    keys.forEach(deleteEnv);
    _resetEnvironmentConfig();
    await Deno.writeTextFile(
      `${directory}/veryfront.config.js`,
      'export default { projectSlug: "proxy-project", fs: { type: "veryfront-api", veryfront: { proxyMode: true } } };\n',
    );
    server = await devCommand({ projectDir: directory, port: 0, demoMode: true, hmr: false });
    assertEquals(getConnectedLocalRuntime(), undefined);
    assertEquals(
      await Deno.stat(`${directory}/veryfront.json`).then(() => true, () => false),
      false,
    );
  } finally {
    await server?.stop();
    keys.forEach((key, i) => {
      if (saved[i] === undefined) deleteEnv(key);
      else setEnv(key, saved[i]!);
    });
    _resetEnvironmentConfig();
    await Deno.remove(directory, { recursive: true });
  }
});
