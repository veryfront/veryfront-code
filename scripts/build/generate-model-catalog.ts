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
 * produces, and writes nothing. Both tasks are run by a person: no job runs
 * either, so a snapshot that has fallen behind never fails an unrelated
 * contributor's build, and nothing in CI needs the token.
 *
 * The token is read from the environment only, never from an argument, and is
 * never printed. Without it the run exits non-zero and writes nothing, so the
 * build, the tests and `deno task verify` all pass with it absent.
 *
 * A vendor the served catalog names that `KnownVeryfrontCloudProviderId` does
 * not list is written out as-is, and the generated module then fails
 * `deno task typecheck`. That is deliberate: adding a vendor means extending
 * that union and the routing overlay, which is a decision for a person.
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
/**
 * Production API origin.
 *
 * The catalog is served at `<origin>/ai/models`, alongside the gateway paths
 * the package itself builds: see the URLs pinned in
 * `src/provider/veryfront-cloud/gateway-routing.test.ts`, which are
 * `https://api.veryfront.com/ai/gateway/<provider>/<version>`. There is no
 * `/api` path prefix, and adding one gets a 404.
 */
const DEFAULT_BASE_URL = "https://api.veryfront.com";
/** Catalog path appended to the API base. */
const CATALOG_PATH = "/ai/models";
/** Generated file, relative to the repository root. */
const DATA_FILE = "src/provider/veryfront-cloud/model-catalog.data.ts";
/** How long the catalog request may stall before the run fails. */
const CATALOG_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Drop trailing slashes from a base URL.
 *
 * Done by scanning rather than by a regular expression: the base comes from an
 * environment variable, and an anchored `/+$` makes the engine retry from
 * every position on a long run of slashes, which is quadratic on input this
 * function does not control. A scan is linear whatever it is handed.
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

/** The catalog URL for a base, with exactly one slash between the two parts. */
export function buildCatalogUrl(baseUrl: string): string {
  return `${stripTrailingSlashes(baseUrl)}${CATALOG_PATH}`;
}

/**
 * Fetch the served catalog. Errors name the status and the catalog path,
 * never the configured base: `VERYFRONT_CATALOG_API_BASE_URL` is an
 * operator's value and may carry a private host or a signed query.
 */
async function fetchServedCatalog(
  baseUrl: string,
  token: string,
): Promise<unknown> {
  const url = buildCatalogUrl(baseUrl);
  const response = await fetch(url, {
    // Without this a stalled connection leaves the command hanging with
    // nothing to say. A run that fails should fail.
    signal: AbortSignal.timeout(CATALOG_REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    // Drain the body so the connection closes without logging its contents.
    await response.body?.cancel();
    // The two failures a person hits look nothing alike and are worth telling
    // apart. Neither message carries the token or the response body.
    if (response.status === 404) {
      throw new Error(
        `Catalog endpoint ${CATALOG_PATH} not found at the configured API base ` +
          `(${BASE_URL_ENV}) - check the base`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Model catalog request was refused with status ${response.status}: ` +
          `the token is missing or not allowed to read the catalog`,
      );
    }
    throw new Error(
      `Model catalog request to ${CATALOG_PATH} failed with status ${response.status}`,
    );
  }
  return await readCatalogJson(response);
}

/**
 * The response body as JSON, or a failure that says only that it was not.
 *
 * A malformed body makes `Response.json()` reject with a message that quotes a
 * fragment of the text, and that fragment is service output this task must
 * not echo. So the parse failure is replaced with one fixed sentence.
 */
export async function readCatalogJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Model catalog response from ${CATALOG_PATH} was not valid JSON`,
    );
  }
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

/** Longest failure line this prints, so a message cannot flood the terminal. */
const MAX_FAILURE_LINE = 400;

/**
 * One line saying what went wrong, and nothing the reader did not ask for.
 *
 * This task runs with a catalog token in its environment and talks to a
 * service whose failures can carry a response body, so an unhandled error is
 * not printed raw. The stack is dropped, the message is flattened to a single
 * line so nothing multi-line can pose as one, URLs are replaced whole (the
 * configured base may carry a private host or a signed query, and no message
 * this task writes needs one — they name the catalog path instead), absolute
 * filesystem paths are cut back to their last segment, and the result is
 * bounded.
 */
export function formatFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const flattened = raw
    .replaceAll("file://", "")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'()]+/gi, "a URL")
    .replace(/\s+/g, " ")
    .trim();
  // POSIX and file-URL paths, then Windows drive-letter (`C:\...`) and UNC
  // (`\\server\share\...`) paths: each is cut back to its last segment.
  const withoutPaths = flattened
    .replace(
      /(?<![:\w/])\/[^\s"'()]*/g,
      (path) => path.slice(path.lastIndexOf("/") + 1) || "a path",
    )
    .replace(
      /(?:\b[A-Za-z]:|\\)\\[^\s"'()]*/g,
      (path) => path.slice(path.lastIndexOf("\\") + 1) || "a path",
    );
  if (withoutPaths === "") return "no reason was given";
  return withoutPaths.length > MAX_FAILURE_LINE
    ? `${withoutPaths.slice(0, MAX_FAILURE_LINE)}...`
    : withoutPaths;
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
      `Routing is not declared for ${unrouted.join(", ")} (positions in the ` +
        `served provider list; the generated diff names them). They are ` +
        `written on the default surface. Add them to ` +
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
  let code = 1;
  try {
    code = await main();
  } catch (error) {
    // `main` reports the failures it expects and returns a code. Anything that
    // reaches here is unplanned, so it is reported the same way: one line, no
    // stack, and nothing the process was holding.
    console.error(
      `Generating ${DATA_FILE} failed: ${formatFailure(error)}`,
    );
  }
  Deno.exit(code);
}
