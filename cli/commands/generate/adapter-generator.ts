/**
 * `veryfront generate adapter <engine>` — vendor a `veryfront/ui` engine adapter.
 *
 * Copies the `<engine>.tsx` reference template (Base UI / Radix / React Aria /
 * Ariakit) verbatim into the consumer's `./ui-adapters/`. From then on the
 * consumer OWNS the file and the engine package is THEIR dependency — `veryfront/ui`
 * core stays engine-free (enforced by a CI guard), so the swap is opt-in and the
 * engine version is on the consumer's schedule. Wire it up once via
 * `<UIAdapterProvider adapter={<engine>Adapter}>` (see the file's docstring).
 *
 * @module cli/commands/generate/adapter-generator
 */
import { join } from "#std/path.ts";
import { bold, brand, dim } from "#cli/ui";
import { cliLogger } from "#cli/utils";
import { createFileSystem } from "veryfront/platform";
import { createError, toError } from "veryfront/errors";
import { ensureDir } from "../../utils/fs.ts";
import { getUiAdapterTemplate, listUiAdapters } from "../../templates/loader.ts";

/** npm package + wiring hint per engine, shown after scaffolding. */
const ENGINE_PACKAGES: Record<string, { pkg: string; adapter: string }> = {
  "base-ui": { pkg: "@base-ui/react", adapter: "baseUiAdapter" },
  radix: {
    pkg:
      "@radix-ui/react-popover @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tooltip",
    adapter: "radixAdapter",
  },
  "react-aria": { pkg: "react-aria-components", adapter: "reactAriaAdapter" },
  ariakit: { pkg: "@ariakit/react", adapter: "ariakitAdapter" },
  vaul: { pkg: "vaul", adapter: "vaulAdapter" },
};

/** Scaffold `ui-adapters/<engine>.tsx` into the project (idempotent — never clobbers). */
export async function generateUiAdapter(
  projectDir: string,
  engine: string,
): Promise<void> {
  const files = getUiAdapterTemplate(engine);
  if (!files || files.length === 0) {
    const available = listUiAdapters();
    throw toError(
      createError({
        type: "config",
        message: available.length
          ? `Unknown ui adapter engine "${engine}". Available: ${available.join(", ")}`
          : `No ui adapter engines are available in this build.`,
      }),
    );
  }

  const fs = createFileSystem();
  const targetDir = join(projectDir, "ui-adapters");
  await ensureDir(targetDir);

  const written: string[] = [];
  for (const file of files) {
    const dest = join(targetDir, file.path);
    if (await fs.exists(dest)) {
      cliLogger.warn(
        `ui-adapters/${file.path} already exists — left as-is (delete it to regenerate).`,
      );
      continue;
    }
    await fs.writeTextFile(dest, file.content);
    written.push(`ui-adapters/${file.path}`);
  }

  const meta = ENGINE_PACKAGES[engine];
  for (const path of written) cliLogger.info(`Created ${brand(path)}`);
  cliLogger.info("");
  cliLogger.info(bold("Next steps:"));
  if (meta) {
    cliLogger.info(`  1. Install the engine:  ${brand(`npm i ${meta.pkg}`)}`);
    cliLogger.info(
      `  2. Wrap your app:       ${
        brand(`<UIAdapterProvider adapter={${meta.adapter}}>…</UIAdapterProvider>`)
      }`,
    );
  }
  cliLogger.info(
    dim(
      "  You own this file now. veryfront/ui core stays engine-free; slots you don't map fall back to builtin.",
    ),
  );
}
