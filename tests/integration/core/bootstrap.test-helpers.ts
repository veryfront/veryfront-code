import "../../_helpers/contract-init.ts";
import { assert, assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat";
import { bootstrap } from "../../../src/server/bootstrap.ts";

export async function createTempDir(prefix: string): Promise<string> {
  return await makeTempDir({ prefix: `bootstrap_test_${prefix}_` });
}

export async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await remove(dir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

export async function writeConfigFile(
  projectDir: string,
  filename: string,
  content: string,
): Promise<void> {
  await writeTextFile(join(projectDir, filename), content);
}

export function createBasicConfig(
  options: {
    title?: string;
    fsType?: string;
    projectSlug?: string;
    apiKey?: string;
    [key: string]: unknown;
  } = {},
): string {
  const { fsType, projectSlug, apiKey, ...rest } = options;

  const config: Record<string, unknown> = {
    title: options.title || "Test Bootstrap App",
    description: "Testing bootstrap module",
    ...rest,
  };

  if (fsType && fsType !== "local") {
    config.fs = {
      type: fsType,
      veryfront: {
        projectSlug: projectSlug || "test-project",
        apiKey: apiKey || "test-api-key",
      },
    };
  }

  return `export default ${JSON.stringify(config, null, 2)};`;
}

export async function withTempProjectDir<T>(
  prefix: string,
  fn: (projectDir: string) => Promise<T>,
): Promise<T> {
  const projectDir = await createTempDir(prefix);
  try {
    return await fn(projectDir);
  } finally {
    await cleanupTempDir(projectDir);
  }
}

export async function expectBootstrapThrows(projectDir: string, adapter: unknown): Promise<void> {
  try {
    await bootstrap(projectDir, adapter as never);
    assert(false, "Should have thrown error");
  } catch (error) {
    assertExists(error);
  }
}

export function withEnvOverrides(vars: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) {
      deleteEnv(key);
    } else {
      setEnv(key, value);
    }
  }

  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        deleteEnv(key);
      } else {
        setEnv(key, value);
      }
    }
  };
}
