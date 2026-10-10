import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl } from "#veryfront/compat/path";

/**
 * Repository-wide inventory of host execution decisions, complementing the
 * handler-only check in `src/server/handlers/execution-surface-policy.test.ts`.
 *
 * It reads source, not behaviour, so an unlisted file fails by construction.
 * Matching is per file and per call shape, never by function name or line, so
 * moving code inside a file keeps the inventory valid. Moving or renaming a
 * file fails with the path to update.
 */

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const SCANNED_ROOTS = ["src/", "cli/"];
const README = "src/security/README.md";
const REGISTER_HEADING = "### Host execution grant register";

/** A call that decides host execution, or a negated capability flag. */
const GUARD =
  /\b(?:requiresIsolatedProjectRuntime|isHostProjectCodeExecutionAllowed|isSharedProjectRuntime|isExplicitHostProjectCodeExecutionAllowed)\s*\(|!\s*allowHostProjectCodeExecution\b/;
/** A literal grant that bypasses those decisions. */
const LITERAL_GRANT = /\ballowHostProjectCodeExecution\s*:\s*true\b/;

/** Files that decide whether tenant code may run on the host, and the surface each one guards. */
const GUARDED_SURFACES: Record<string, { surface: string; guard?: RegExp }> = {
  "src/discovery/discovery-engine.ts": { surface: "Executable primitive discovery" },
  "src/discovery/transpiler.ts": { surface: "Discovery module transpilation and import" },
  "src/routing/api/handler.ts": { surface: "API route ownership and host-realm selection" },
  "src/routing/api/module-loader/loader.ts": { surface: "API route module loading" },
  "src/routing/api/route-executor.ts": { surface: "API route execution" },
  "src/server/dev-server/middleware.ts": { surface: "Local development middleware" },
  "src/server/handlers/preview/markdown-preview.handler.ts": { surface: "Markdown preview" },
  "src/server/handlers/request/api/api-handler-wrapper.ts": { surface: "API handler wrapper" },
  "src/server/handlers/request/api/app-router-handler.ts": { surface: "App router API routes" },
  "src/server/handlers/request/api/project-discovery.ts": { surface: "Request-time discovery" },
  "src/server/handlers/request/module/module.handler.ts": { surface: "Module server" },
  "src/server/handlers/request/openapi.handler.ts": {
    surface: "Runtime OpenAPI generation",
    guard: /\bisLocalProject\s*!==\s*true\b/,
  },
  "src/server/handlers/request/public-agent-metadata.handler.ts": {
    surface: "Public agent metadata",
  },
  "src/server/handlers/request/public-agents-list.handler.ts": { surface: "Public agent list" },
  "src/server/handlers/request/rsc/index.ts": { surface: "RSC request handler" },
  "src/server/handlers/request/snippet.handler.ts": { surface: "Component snippets" },
  "src/server/handlers/request/ssr/ssr.handler.ts": { surface: "SSR handler" },
  "src/server/handlers/response/cors.ts": { surface: "CORS preflight route inspection" },
  "src/server/production-server.ts": { surface: "Startup execution posture" },
  "src/server/runtime-handler/index.ts": { surface: "Root middleware and hosted ingress" },
  "src/server/runtime-handler/project-middleware.ts": { surface: "Project middleware" },
  "src/server/services/rendering/ssr.service.ts": { surface: "SSR service" },
  "src/server/services/rsc/endpoints/endpoint-router.ts": { surface: "RSC server endpoints" },
};

/** Definitions of the predicates themselves are not surfaces. */
const PREDICATE_DEFINITIONS = new Set(["src/security/project-locality.ts"]);

/** Drop imports and comments so only real code counts. */
function codeOf(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("import ") && !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

async function readSources(): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  async function walk(relativeDir: string): Promise<void> {
    for await (const entry of Deno.readDir(`${REPO_ROOT}${relativeDir}`)) {
      const relativePath = `${relativeDir}${entry.name}`;
      if (entry.isDirectory) {
        await walk(`${relativePath}/`);
        continue;
      }
      if (
        !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts") ||
        entry.name.endsWith(".test-helpers.ts") || entry.name.endsWith(".d.ts")
      ) continue;
      sources.set(relativePath, codeOf(await Deno.readTextFile(`${REPO_ROOT}${relativePath}`)));
    }
  }
  for (const root of SCANNED_ROOTS) await walk(root);
  return sources;
}

let cachedSources: Promise<Map<string, string>> | undefined;
function sources(): Promise<Map<string, string>> {
  cachedSources ??= readSources();
  return cachedSources;
}

/** Rows of the README register: file path, consumer, grant basis. */
async function readRegister(): Promise<Map<string, { consumer: string; basis: string }>> {
  const text = await Deno.readTextFile(`${REPO_ROOT}${README}`);
  const start = text.indexOf(REGISTER_HEADING);
  if (start < 0) throw new Error(`${README} is missing "${REGISTER_HEADING}"`);
  const section = text.slice(start + REGISTER_HEADING.length).split(/\n#{1,3} /)[0]!;
  const rows = new Map<string, { consumer: string; basis: string }>();
  for (const line of section.split("\n")) {
    const match = /^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|\s*$/.exec(line.trim());
    if (match) {
      rows.set(match[1]!, { consumer: match[2]!.trim(), basis: match[3]!.trim() });
    }
  }
  return rows;
}

describe("execution surface inventory", () => {
  it("lists every file that decides host execution", async () => {
    const all = await sources();
    const unlisted = [...all.entries()]
      .filter(([path, code]) =>
        GUARD.test(code) && !(path in GUARDED_SURFACES) && !PREDICATE_DEFINITIONS.has(path)
      )
      .map(([path]) => path)
      .toSorted();
    assertEquals(
      unlisted,
      [],
      "These files decide whether tenant code runs on the host but are not inventoried. " +
        "Add each to GUARDED_SURFACES with the surface it guards.",
    );
  });

  it("keeps every inventoried guard in place", async () => {
    const all = await sources();
    const missing = Object.entries(GUARDED_SURFACES)
      .filter(([path, entry]) => {
        const code = all.get(path);
        return code === undefined || !(entry.guard ?? GUARD).test(code);
      })
      .map(([path]) => path);
    assertEquals(
      missing,
      [],
      "These inventoried files no longer exist or no longer contain their guard. If the file " +
        "moved, update its path. If the guard was removed, restore it or remove the entry " +
        "deliberately.",
    );
  });

  it("registers every literal host execution grant with its consumer and grant basis", async () => {
    const all = await sources();
    const register = await readRegister();
    const grants = [...all.entries()]
      .filter(([, code]) => LITERAL_GRANT.test(code))
      .map(([path]) => path)
      .toSorted();
    assertEquals(
      grants.filter((path) => !register.has(path)),
      [],
      `These files pass allowHostProjectCodeExecution: true but are missing from ` +
        `"${REGISTER_HEADING}" in ${README}.`,
    );
    assertEquals(
      [...register.keys()].filter((path) => !grants.includes(path)).toSorted(),
      [],
      `These "${REGISTER_HEADING}" rows no longer match a literal grant. Remove or move them.`,
    );
    assertEquals(
      [...register.entries()]
        .filter(([, row]) => !row.consumer || !row.basis)
        .map(([path]) => path),
      [],
      "Each registered grant needs a consumer and a grant basis.",
    );
  });
});
