#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read --allow-write --allow-run=deno
/**
 * Generates `src/provider/veryfront-cloud/model-catalog.data.ts` from the
 * catalog the platform publishes, so the snapshot that ships inside the
 * package is no longer maintained by hand.
 *
 * Usage:
 *
 * ```bash
 * VERYFRONT_CATALOG_READ_TOKEN=<TOKEN> deno task generate:model-catalog
 * VERYFRONT_CATALOG_READ_TOKEN=<TOKEN> deno task generate:model-catalog:check
 * ```
 *
 * `--check` exits non-zero when the file on disk differs from what this run
 * produces, and writes nothing. It is for local use only: no pull-request job
 * runs it, so a snapshot that has fallen behind never fails an unrelated
 * contributor's build, and a fork never needs the token. The scheduled sync
 * workflow failing is the signal instead.
 *
 * The token is read from the environment only, never from an argument, and is
 * never printed. Without it the run exits non-zero and writes nothing, so the
 * build, the tests and `deno task verify` all pass with it absent.
 *
 * A vendor the served catalog names that `KnownVeryfrontCloudProviderId` does
 * not list is written out as-is. The generated module then fails `deno task
 * typecheck`, which is deliberate: adding a vendor is a decision for a person,
 * and the failure says so on the sync pull request rather than silently.
 *
 * @module scripts/build/generate-model-catalog
 */

import { fromFileUrl } from "#std/path";
import {
  buildModelCatalogData,
  findUnroutedProviders,
  renderModelCatalogModule,
} from "./model-catalog-mapping.ts";
import { MODEL_CATALOG_OVERLAY } from "./model-catalog-overlay.ts";

/** Environment variable holding the read-only catalog token. */
const TOKEN_ENV = "VERYFRONT_CATALOG_READ_TOKEN";
/** Environment variable that points a local run at another API base. */
const BASE_URL_ENV = "VERYFRONT_CATALOG_API_BASE_URL";
/** Production REST API base, including the REST path prefix. */
const DEFAULT_BASE_URL = "https://api.veryfront.com/api";
/** Catalog path appended to the API base. */
const CATALOG_PATH = "/ai/models";
/** Generated file, relative to the repository root. */
const DATA_FILE = "src/provider/veryfront-cloud/model-catalog.data.ts";

/** Fetch the served catalog. Errors name the status, never the response body. */
async function fetchServedCatalog(
  baseUrl: string,
  token: string,
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/+$/, "")}${CATALOG_PATH}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    // Drain the body so the connection closes without logging its contents.
    await response.body?.cancel();
    throw new Error(
      `Model catalog request failed with status ${response.status}`,
    );
  }
  return await response.json();
}

/** Run the repository formatter over the module source. */
async function formatModule(repoRoot: string, source: string): Promise<string> {
  const command = new Deno.Command("deno", {
    args: ["fmt", "--ext", "ts", "-"],
    cwd: repoRoot,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const process = command.spawn();
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(source));
  await writer.close();
  const output = await process.output();
  if (!output.success) {
    throw new Error(
      `deno fmt failed: ${new TextDecoder().decode(output.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(output.stdout);
}

async function main(): Promise<number> {
  const check = Deno.args.includes("--check");
  const repoRoot = fromFileUrl(new URL("../../", import.meta.url));

  const token = Deno.env.get(TOKEN_ENV);
  if (!token) {
    console.error(
      `${TOKEN_ENV} is not set. Set it to a token that can read the model ` +
        `catalog and nothing else, then run this task again. Nothing was written.`,
    );
    return 1;
  }

  const baseUrl = Deno.env.get(BASE_URL_ENV) || DEFAULT_BASE_URL;
  const payload = await fetchServedCatalog(baseUrl, token);
  const data = buildModelCatalogData(payload, MODEL_CATALOG_OVERLAY);

  const unrouted = findUnroutedProviders(data, MODEL_CATALOG_OVERLAY);
  if (unrouted.length > 0) {
    console.error(
      `Routing is not declared for: ${unrouted.join(", ")}. ` +
        `They are written on the default surface. Add them to ` +
        `scripts/build/model-catalog-overlay.ts.`,
    );
  }

  const source = await formatModule(repoRoot, renderModelCatalogModule(data));
  const target = `${repoRoot}${DATA_FILE}`;
  const current = await Deno.readTextFile(target).catch(() => undefined);

  if (check) {
    if (current === source) {
      console.log(`${DATA_FILE} is up to date.`);
      return 0;
    }
    console.error(
      `${DATA_FILE} is out of date. Run \`deno task generate:model-catalog\`.`,
    );
    return 1;
  }

  if (current === source) {
    console.log(`${DATA_FILE} is unchanged.`);
    return 0;
  }
  await Deno.writeTextFile(target, source);
  console.log(
    `Wrote ${DATA_FILE} with ${data.chatModels.length} model entries.`,
  );
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
