import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { fromFileUrl } from "#veryfront/platform/compat/path/index.ts";
import {
  CommonSchemas as clientCommonSchemas,
  createValidatedHandler as clientCreateValidatedHandler,
  createValidationError as clientCreateValidationError,
  csrfMutationHeaders,
  INPUT_VALIDATION_FAILED as CLIENT_INPUT_VALIDATION_FAILED,
  parseFormData as clientParseFormData,
  parseJsonBody as clientParseJsonBody,
  parseQueryParams as clientParseQueryParams,
  sanitizeData as clientSanitizeData,
} from "./index.client.ts";
import {
  CommonSchemas,
  createValidatedHandler,
  createValidationError,
  INPUT_VALIDATION_FAILED,
  parseFormData,
  parseJsonBody,
  parseQueryParams,
  sanitizeData,
} from "./security/input-validation/index.ts";

import {
  collectClientGraph,
  findServerOnlyLeaks,
  SERVER_ONLY_MODULE_PATTERNS,
  traceLeak,
} from "../scripts/lint/client-bundle-graph.ts";

const REPO_ROOT = new URL("../", import.meta.url);
const readRepoFile = (path: string): Promise<string> =>
  readTextFile(fromFileUrl(new URL(path, REPO_ROOT)));

// Use the runtime-neutral filesystem boundary so Node and Bun run this guard
// too. The shared parser follows real value imports, including side effects,
// and rejects Node builtins rather than silently treating them as external.
async function readModule(path: string): Promise<{ path: string; source: string } | null> {
  const candidates = /\.(?:[cm]?[jt]sx?|json)$/.test(path)
    ? [path]
    : [path + ".ts", path + ".tsx", path + "/index.ts", path + "/index.tsx"];
  for (const candidate of candidates) {
    try {
      return { path: candidate, source: await readRepoFile(candidate) };
    } catch (error) {
      if (
        (error as { code?: string }).code !== "ENOENT" &&
        (error as { name?: string }).name !== "NotFound"
      ) throw error;
    }
  }
  return null;
}

describe("index.client static import boundary", () => {
  it("exports the browser CSRF mutation helper", () => {
    assertEquals(typeof csrfMutationHeaders, "function");
  });

  it("exports browser-safe validation helpers from the input-validation leaf", () => {
    assertEquals(clientCommonSchemas, CommonSchemas);
    assertEquals(clientCreateValidatedHandler, createValidatedHandler);
    assertEquals(clientCreateValidationError, createValidationError);
    assertEquals(CLIENT_INPUT_VALIDATION_FAILED, INPUT_VALIDATION_FAILED);
    assertEquals(clientParseFormData, parseFormData);
    assertEquals(clientParseJsonBody, parseJsonBody);
    assertEquals(clientParseQueryParams, parseQueryParams);
    assertEquals(clientSanitizeData, sanitizeData);
  });

  it("never reaches server modules or unpolyfilled Node builtins (#3661, #5165)", async () => {
    const map = JSON.parse(await readRepoFile("deno.json")).imports;
    const graph = await collectClientGraph("src/index.client.ts", map, readModule);
    assert(graph.has("src/index.client.ts"), "entry module was not read");
    assert(graph.size > 10, `expected a non-trivial graph, got ${graph.size} modules`);
    const leaks = findServerOnlyLeaks(graph);
    assertEquals(leaks, [], leaks.map((leak) => traceLeak(graph, leak)).join("\n"));
  });

  it("server-only patterns still cover the runtime adapters", async () => {
    for (
      const path of [
        "src/platform/adapters/runtime/deno/adapter.ts",
        "src/platform/adapters/runtime/node/adapter.ts",
        "src/platform/adapters/runtime/bun/adapter.ts",
        "src/platform/adapters/runtime/cloudflare/adapter.ts",
        "src/platform/adapters/runtime/deno/filesystem-adapter.ts",
        "src/platform/adapters/runtime/node/filesystem-adapter.ts",
        "src/platform/adapters/runtime/bun/filesystem-adapter.ts",
        "src/platform/adapters/runtime/shared/node-filesystem-adapter.ts",
        "src/security/application-auth/identity.ts",
        "src/security/application-auth/trusted-proxy.ts",
      ]
    ) {
      assert(await readModule(path), `${path} no longer exists`);
      assert(
        SERVER_ONLY_MODULE_PATTERNS.some((pattern) => pattern.test("/" + path)),
        `${path} is no longer guarded`,
      );
    }
  });
});
