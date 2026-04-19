import { join } from "#veryfront/compat/path";
import { writeTextFile } from "#veryfront/testing/deno-compat";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { withTestContext } from "../../_helpers/context.ts";

type ImportMapTestContext = {
  projectDir: string;
};

type ImportMapTestAdapter = Awaited<ReturnType<typeof getAdapter>>;

export async function withImportMapTestContext(
  name: string,
  fn: (context: ImportMapTestContext, adapter: ImportMapTestAdapter) => Promise<void>,
): Promise<void> {
  await withTestContext(name, async (context) => {
    const adapter = await getAdapter();
    await fn(context, adapter);
  });
}

export async function writeDenoJson(projectDir: string, config: unknown): Promise<void> {
  await writeTextFile(join(projectDir, "deno.json"), JSON.stringify(config, null, 2));
}

export function loadImportMapForTest(projectDir: string, adapter: ImportMapTestAdapter) {
  return loadImportMap(projectDir, adapter);
}
