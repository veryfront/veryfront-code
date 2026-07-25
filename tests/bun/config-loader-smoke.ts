import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep framework imports dynamic so the Bun preload resolver is registered
// before workspace aliases and extension-specific import-map entries resolve.
await import("#veryfront/schemas/_test-setup.ts");
const { clearConfigCache, getConfig } = await import("veryfront/config");
const { VeryfrontError } = await import("veryfront/errors");
const { getAdapter } = await import("veryfront/platform");

const CONFIG_FILE = "veryfront.config.ts";
const EXPECTED_PORT = 4319;

function validConfigSource(title: string): string {
  return `
import * as veryfront from "veryfront";

type BunSmokeTitle = string;
const title: BunSmokeTitle = ${JSON.stringify(title)};

if ("json" in veryfront) {
  throw new Error("Bun config loader did not rewrite the bare veryfront import");
}

export default veryfront.mergeConfigs(
  veryfront.defineConfig({
    title,
    description: import.meta.url.includes("vf-config-")
      ? "loaded-from-temp-file"
      : "loaded-directly",
  }),
  { dev: { port: ${EXPECTED_PORT} } },
);
`;
}

async function runSmoke(): Promise<void> {
  const projectDir = await mkdtemp(join(tmpdir(), "vf bun config #%-"));
  const configPath = join(projectDir, CONFIG_FILE);
  const bunAdapter = await getAdapter();

  try {
    assert.equal(bunAdapter.id, "bun");
    assert.match(projectDir, /vf bun config #%/);

    clearConfigCache();
    const firstSource = validConfigSource("Bun config revision 1");
    await writeFile(configPath, firstSource, "utf8");

    const first = await getConfig(projectDir, bunAdapter);
    assert.equal(first.title, "Bun config revision 1");
    assert.equal(first.description, "loaded-from-temp-file");
    assert.ok(first.dev);
    assert.equal(first.dev.port, EXPECTED_PORT);

    await writeFile(configPath, validConfigSource("Bun config revision 2"), "utf8");
    const cached = await getConfig(projectDir, bunAdapter);
    assert.strictEqual(cached, first);
    assert.equal(cached.title, "Bun config revision 1");

    clearConfigCache();
    const reloaded = await getConfig(projectDir, bunAdapter);
    assert.notStrictEqual(reloaded, first);
    assert.equal(reloaded.title, "Bun config revision 2");
    assert.equal(reloaded.description, "loaded-from-temp-file");

    await writeFile(
      configPath,
      'import * as veryfront from "veryfront";\n' +
        'export default veryfront.defineConfig({ dev: { port: "not-a-port" } });\n',
      "utf8",
    );
    clearConfigCache();

    await assert.rejects(
      () => getConfig(projectDir, bunAdapter),
      (error: unknown) => {
        assert.ok(error instanceof VeryfrontError);
        assert.equal(error.slug, "config-validation-failed");
        assert.match(error.message, /Invalid veryfront\.config at dev\.port/);
        return true;
      },
    );
  } finally {
    clearConfigCache();
    await rm(projectDir, { recursive: true, force: true });
  }
}

await runSmoke();
console.log("Bun config loader smoke passed");
