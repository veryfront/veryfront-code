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

/**
 * A call that decides host execution, or any comparison of the capability flag:
 * `!allowHostProjectCodeExecution`, or `allowHostProjectCodeExecution` compared with
 * `true` or `false`.
 */
const GUARD =
  /\b(?:requiresIsolatedProjectRuntime|isHostProjectCodeExecutionAllowed|isSharedProjectRuntime|isExplicitHostProjectCodeExecutionAllowed|isHostRealmApiExecution)\s*\(|!\s*allowHostProjectCodeExecution\b|\ballowHostProjectCodeExecution\s*[!=]==?\s*(?:true|false)\b/g;
/** A literal grant that bypasses those decisions. */
const LITERAL_GRANT = /\ballowHostProjectCodeExecution\s*:\s*true\b/g;

/**
 * Files that decide whether tenant code may run on the host, the surface each one guards,
 * and how many guards the file holds. Counting guards per file, not lines, keeps the
 * inventory valid when code moves inside a file, while removing any one guard fails.
 */
const GUARDED_SURFACES: Record<string, { surface: string; guards: number; guard?: RegExp }> = {
  "src/data/server-data-fetcher.ts": { surface: "Remote server-data execution", guards: 1 },
  "src/discovery/discovery-engine.ts": { surface: "Executable primitive discovery", guards: 1 },
  "src/discovery/project-discovery-config.ts": {
    surface: "Discovery capability normalization",
    guards: 1,
  },
  "src/rendering/context/render-context.ts": {
    surface: "Render context capability",
    guards: 2,
  },
  "src/rendering/orchestrator/pipeline.ts": { surface: "Render pipeline capability", guards: 1 },
  "src/discovery/transpiler.ts": {
    surface: "Discovery module transpilation and import",
    guards: 1,
  },
  "src/routing/api/handler.ts": {
    surface: "API route ownership and host-realm selection",
    guards: 6,
  },
  "src/routing/api/module-loader/loader.ts": { surface: "API route module loading", guards: 1 },
  "src/routing/api/openapi/spec-generator.ts": { surface: "OpenAPI route evaluation", guards: 1 },
  "src/routing/api/route-executor.ts": { surface: "API route execution", guards: 3 },
  "src/server/context/enriched-context.ts": {
    surface: "Enriched request context capability",
    guards: 1,
  },
  "src/server/dev-server/middleware.ts": { surface: "Local development middleware", guards: 1 },
  "src/server/handlers/preview/markdown-preview.handler.ts": {
    surface: "Markdown preview",
    guards: 1,
  },
  "src/server/handlers/request/api/api-handler-wrapper.ts": {
    surface: "API handler wrapper",
    guards: 2,
  },
  "src/server/handlers/request/api/app-router-handler.ts": {
    surface: "App router API routes",
    guards: 1,
  },
  "src/server/handlers/request/api/project-discovery.ts": {
    surface: "Request-time discovery",
    guards: 1,
  },
  "src/server/handlers/request/module/module.handler.ts": { surface: "Module server", guards: 1 },
  "src/server/handlers/request/openapi.handler.ts": {
    surface: "Runtime OpenAPI generation",
    guards: 1,
    guard: /\bisLocalProject\s*!==\s*true\b/g,
  },
  "src/server/handlers/request/public-agent-metadata.handler.ts": {
    surface: "Public agent metadata",
    guards: 1,
  },
  "src/server/handlers/request/public-agents-list.handler.ts": {
    surface: "Public agent list",
    guards: 1,
  },
  "src/server/handlers/request/rsc/index.ts": { surface: "RSC request handler", guards: 1 },
  "src/server/handlers/request/snippet.handler.ts": { surface: "Component snippets", guards: 1 },
  "src/server/handlers/request/ssr/ssr.handler.ts": { surface: "SSR handler", guards: 1 },
  "src/server/handlers/response/cors.ts": {
    surface: "CORS preflight route inspection",
    guards: 2,
  },
  "src/server/production-server.ts": { surface: "Startup execution posture", guards: 1 },
  "src/server/runtime-handler/adapter-factory.ts": {
    surface: "Preview configuration refresh",
    guards: 1,
  },
  "src/server/runtime-handler/index.ts": {
    surface: "Root middleware and hosted ingress",
    guards: 3,
  },
  "src/server/runtime-handler/project-runtime-context.ts": {
    surface: "Project runtime context capability",
    guards: 1,
  },
  "src/server/runtime-handler/project-middleware.ts": { surface: "Project middleware", guards: 1 },
  "src/server/services/rendering/ssr.service.ts": { surface: "SSR service", guards: 2 },
  "src/server/shared/renderer/adapter.ts": { surface: "Renderer adapter capability", guards: 1 },
  "src/server/services/rsc/endpoints/endpoint-router.ts": {
    surface: "RSC server endpoints",
    guards: 1,
  },
};

function countGuards(code: string, pattern: RegExp = GUARD): number {
  return code.match(new RegExp(pattern.source, "g"))?.length ?? 0;
}

/** Definitions of the predicates themselves are not surfaces. */
const PREDICATE_DEFINITIONS = new Set([
  "src/security/project-locality.ts",
  "src/security/sandbox/worker-pool.ts",
]);

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
        !/\.tsx?$/.test(entry.name) || /\.(?:test|test-helpers)\.tsx?$/.test(entry.name) ||
        entry.name.endsWith(".d.ts")
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

interface RegisterRow {
  consumer: string;
  basis: string;
  grants: number;
}

/** Rows of the README register: file path, consumer, grant basis, grant count. */
async function readRegister(): Promise<Map<string, RegisterRow>> {
  const text = await Deno.readTextFile(`${REPO_ROOT}${README}`);
  const start = text.indexOf(REGISTER_HEADING);
  if (start < 0) throw new Error(`${README} is missing "${REGISTER_HEADING}"`);
  const section = text.slice(start + REGISTER_HEADING.length).split(/\n#{1,3} /)[0]!;
  const rows = new Map<string, RegisterRow>();
  for (const line of section.split("\n")) {
    const match = /^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|\s*(\d+)\s*\|\s*$/.exec(line.trim());
    if (match) {
      rows.set(match[1]!, {
        consumer: match[2]!.trim(),
        basis: match[3]!.trim(),
        grants: Number(match[4]),
      });
    }
  }
  return rows;
}

describe("execution surface inventory", () => {
  it("lists every file that decides host execution", async () => {
    const all = await sources();
    const unlisted = [...all.entries()]
      .filter(([path, code]) =>
        countGuards(code) > 0 && !(path in GUARDED_SURFACES) &&
        !PREDICATE_DEFINITIONS.has(path)
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
    const changed = Object.entries(GUARDED_SURFACES)
      .map(([path, entry]) => {
        const code = all.get(path);
        const found = code === undefined ? "missing file" : countGuards(code, entry.guard);
        return { path, expected: entry.guards, found };
      })
      .filter(({ expected, found }) => found !== expected);
    assertEquals(
      changed,
      [],
      "These inventoried files no longer exist or hold a different number of guards. If the " +
        "file moved, update its path. If a guard was added, update its count. If a guard was " +
        "removed, restore it or update the entry deliberately.",
    );
  });

  it("registers every literal host execution grant with its consumer, grant basis and count", async () => {
    const all = await sources();
    const register = await readRegister();
    const grantCounts = new Map(
      [...all.entries()]
        .map(([path, code]) => [path, countGuards(code, LITERAL_GRANT)] as const)
        .filter(([, count]) => count > 0),
    );
    const grants = [...grantCounts.keys()].toSorted();
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
    assertEquals(
      grants
        .filter((path) => register.get(path)?.grants !== grantCounts.get(path))
        .map((path) => ({
          path,
          registered: register.get(path)?.grants,
          found: grantCounts.get(path),
        })),
      [],
      "These files hold a different number of literal grants than the register lists. " +
        "Register each new grant deliberately.",
    );
  });
});
