import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl } from "#veryfront/compat/path";
import { parse } from "npm:@babel/parser@7.29.2";

/**
 * Repository-wide inventory of host execution decisions, complementing the
 * handler-only check in `src/server/handlers/execution-surface-policy.test.ts`.
 *
 * It reads source, not behaviour, so an unlisted file fails by construction.
 * Each file is parsed into a TypeScript syntax tree, so comments and string,
 * template and regular expression contents can never count or hide a guard.
 * Counting is per file, never by function name or line, so moving code inside a
 * file keeps the inventory valid. Moving or renaming a file fails with the path
 * to update.
 */

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const SCANNED_ROOTS = ["src/", "cli/"];
const README = "src/security/README.md";
const REGISTER_HEADING = "### Host execution grant register";

/** Calls that decide whether tenant code may run on the host. */
const PREDICATES = new Set([
  "requiresIsolatedProjectRuntime",
  "isHostProjectCodeExecutionAllowed",
  "isSharedProjectRuntime",
  "isExplicitHostProjectCodeExecutionAllowed",
  "isHostRealmApiExecution",
  "isHostProjectExecutionOverrideEnabled",
]);
const FLAG = "allowHostProjectCodeExecution";

/**
 * Files that decide whether tenant code may run on the host, the surface each one guards,
 * and how many guards the file holds. Counting guards per file, not lines, keeps the
 * inventory valid when code moves inside a file, while removing any one guard fails.
 */
const GUARDED_SURFACES: Record<
  string,
  { surface: string; guards: number; countLocalProjectChecks?: boolean }
> = {
  "src/agent/project/agent-runtime.ts": {
    surface: "Project agent runtime capability",
    guards: 2,
  },
  "src/data/data-fetcher.ts": {
    surface: "Data fetcher capability",
    guards: 2,
  },
  "src/data/server-data-fetcher.ts": {
    surface: "Remote server-data execution",
    guards: 1,
  },
  "src/discovery/discovery-engine.ts": {
    surface: "Executable primitive discovery",
    guards: 1,
  },
  "src/discovery/module-import.ts": {
    surface: "Discovery module import capability",
    guards: 2,
  },
  "src/discovery/project-discovery-config.ts": {
    surface: "Discovery capability normalization",
    guards: 2,
  },
  "src/discovery/transpiler.ts": {
    surface: "Discovery module transpilation and import",
    guards: 1,
  },
  "src/eval/discovery.ts": {
    surface: "Eval discovery capability",
    guards: 4,
  },
  "src/rendering/context/render-context.ts": {
    surface: "Render context capability",
    guards: 4,
  },
  "src/rendering/orchestrator/pipeline.ts": {
    surface: "Render pipeline capability",
    guards: 5,
  },
  "src/rendering/renderer.ts": {
    surface: "Renderer capability",
    guards: 2,
  },
  "src/routing/api/handler.ts": {
    surface: "API route ownership and host-realm selection",
    guards: 10,
  },
  "src/routing/api/module-loader/loader.ts": {
    surface: "API route module loading",
    guards: 1,
  },
  "src/routing/api/openapi/spec-generator.ts": {
    surface: "OpenAPI route evaluation",
    guards: 1,
  },
  "src/routing/api/route-executor.ts": {
    surface: "API route execution",
    guards: 5,
  },
  "src/schedule/discovery.ts": {
    surface: "Schedule discovery capability",
    guards: 2,
  },
  "src/server/context/enriched-context.ts": {
    surface: "Enriched request context capability",
    guards: 2,
  },
  "src/server/dev-server/middleware.ts": {
    surface: "Local development middleware",
    guards: 1,
  },
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
  "src/server/handlers/request/module/module.handler.ts": {
    surface: "Module server",
    guards: 1,
  },
  "src/server/handlers/request/project-run-execute.handler.ts": {
    surface: "Project run execution capability",
    guards: 4,
  },
  "src/server/handlers/request/public-agent-metadata.handler.ts": {
    surface: "Public agent metadata",
    guards: 1,
  },
  "src/server/handlers/request/public-agents-list.handler.ts": {
    surface: "Public agent list",
    guards: 1,
  },
  "src/server/handlers/request/rsc/index.ts": {
    surface: "RSC request handler",
    guards: 2,
  },
  "src/server/handlers/request/snippet.handler.ts": {
    surface: "Component snippets",
    guards: 1,
  },
  "src/server/handlers/request/ssr/ssr.handler.ts": {
    surface: "SSR handler",
    guards: 1,
  },
  "src/server/handlers/response/cors.ts": {
    surface: "CORS preflight route inspection",
    guards: 2,
  },
  "src/server/production-server.ts": {
    surface: "Startup execution posture",
    guards: 6,
  },
  "src/server/runtime-handler/adapter-factory.ts": {
    surface: "Preview configuration refresh",
    guards: 1,
  },
  "src/server/runtime-handler/handler-context-builder.ts": {
    surface: "Handler context capability",
    guards: 4,
  },
  "src/server/runtime-handler/index.ts": {
    surface: "Root middleware and hosted ingress",
    guards: 5,
  },
  "src/server/runtime-handler/project-middleware.ts": {
    surface: "Project middleware",
    guards: 13,
  },
  "src/server/runtime-handler/project-runtime-context.ts": {
    surface: "Project runtime context capability",
    guards: 4,
  },
  "src/server/services/rendering/ssr.service.ts": {
    surface: "SSR service",
    guards: 2,
  },
  "src/server/services/rsc/endpoints/endpoint-router.ts": {
    surface: "RSC server endpoints",
    guards: 2,
  },
  "src/server/shared/renderer/adapter.ts": {
    surface: "Renderer adapter capability",
    guards: 4,
  },
  "src/server/startup-discovery.ts": {
    surface: "Startup discovery capability",
    guards: 2,
  },
  "src/task/discovery.ts": {
    surface: "Task discovery capability",
    guards: 6,
  },
  "src/task/project-runtime.ts": {
    surface: "Task project runtime capability",
    guards: 2,
  },
  "src/trigger/discovery.ts": {
    surface: "Trigger discovery capability",
    guards: 2,
  },
  "src/webhook/discovery.ts": {
    surface: "Webhook discovery capability",
    guards: 2,
  },
  "src/workflow/discovery/workflow-discovery.ts": {
    surface: "Workflow discovery capability",
    guards: 2,
  },
  "src/server/handlers/request/openapi.handler.ts": {
    surface: "Runtime OpenAPI generation",
    guards: 1,
    countLocalProjectChecks: true,
  },
};

/** Definitions of the predicates themselves are not surfaces. */
const PREDICATE_DEFINITIONS = new Set([
  "src/security/host-execution-policy.ts",
  "src/security/project-locality.ts",
  "src/security/sandbox/worker-pool.ts",
]);

interface SourceAnalysis {
  /** Predicate calls and uses of the capability flag in runtime code. */
  guards: number;
  /** Literal `allowHostProjectCodeExecution: true` grants, in values or types. */
  grants: number;
  /** `isLocalProject !== true` checks. */
  localProjectChecks: number;
}

type SyntaxNode = { type: string; [key: string]: unknown };

const SKIPPED_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "tokens",
]);
/** Subtrees that only describe types. Inside them, only literal-true grants count. */
const TYPE_ONLY_NODES = new Set([
  "TSTypeAnnotation",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSTypeParameterDeclaration",
  "TSTypeParameterInstantiation",
  "TSDeclareFunction",
  "TSDeclareMethod",
]);

function isNode(value: unknown): value is SyntaxNode {
  return value !== null && typeof value === "object" &&
    typeof (value as SyntaxNode).type === "string";
}

function nameOf(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "Identifier") return node.name as string;
  if (node.type === "StringLiteral") return node.value as string;
  return undefined;
}

function isTrue(node: unknown): boolean {
  return isNode(node) && node.type === "BooleanLiteral" && node.value === true;
}

/**
 * Count guards and grants in one source file from its syntax tree. Runtime code counts
 * every call of a predicate and every use of the flag: reads on any receiver, negations,
 * comparisons, conditions, destructuring and propagation keys. Class property
 * declarations and type positions are not uses. A property `allowHostProjectCodeExecution:
 * true`, in a value or a type, is a literal grant.
 */
function analyzeSource(source: string, tsx: boolean): SourceAnalysis {
  const ast = parse(source, {
    sourceType: "module",
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    errorRecovery: false,
    plugins: tsx
      ? ["typescript", "jsx", "decorators-legacy", "importAttributes"]
      : ["typescript", "decorators-legacy", "importAttributes"],
  });
  const result: SourceAnalysis = { guards: 0, grants: 0, localProjectChecks: 0 };

  const visitChildren = (node: SyntaxNode, inType: boolean, skip?: unknown) => {
    for (const [key, value] of Object.entries(node)) {
      if (SKIPPED_KEYS.has(key) || value === skip) continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item, inType);
      } else if (isNode(value)) {
        visit(value, inType);
      }
    }
  };

  const visit = (node: SyntaxNode, inType: boolean): void => {
    if (TYPE_ONLY_NODES.has(node.type)) inType = true;
    if (inType) {
      if (
        node.type === "TSPropertySignature" && nameOf(node.key) === FLAG &&
        isNode(node.typeAnnotation) && isNode(node.typeAnnotation.typeAnnotation) &&
        node.typeAnnotation.typeAnnotation.type === "TSLiteralType" &&
        isTrue(node.typeAnnotation.typeAnnotation.literal)
      ) result.grants++;
      visitChildren(node, true);
      return;
    }
    switch (node.type) {
      case "CallExpression":
      case "OptionalCallExpression": {
        const callee = node.callee;
        const name = isNode(callee) &&
            (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") &&
            !callee.computed
          ? nameOf(callee.property)
          : nameOf(callee);
        if (name !== undefined && PREDICATES.has(name)) result.guards++;
        break;
      }
      case "Identifier":
        if (node.name === FLAG) result.guards++;
        break;
      case "ObjectProperty":
        if (nameOf(node.key) === FLAG && !node.computed) {
          if (isTrue(node.value)) {
            result.grants++;
            return;
          }
          // A shorthand property is one use; a keyed one is a use plus its value.
          result.guards++;
          if (node.shorthand) return;
          visitChildren(node, false, node.key);
          return;
        }
        break;
      case "ClassProperty":
      case "ClassAccessorProperty":
        if (nameOf(node.key) === FLAG) {
          visitChildren(node, false, node.key);
          return;
        }
        break;
      case "BinaryExpression":
        if (
          node.operator === "!==" &&
          [node.left, node.right].some((side) =>
            isNode(side) &&
            (side.type === "MemberExpression" || side.type === "OptionalMemberExpression"
              ? nameOf(side.property) === "isLocalProject"
              : nameOf(side) === "isLocalProject")
          ) &&
          [node.left, node.right].some(isTrue)
        ) result.localProjectChecks++;
        break;
    }
    visitChildren(node, false);
  };

  visit(ast.program as unknown as SyntaxNode, false);
  return result;
}

async function readSources(): Promise<Map<string, SourceAnalysis>> {
  const sources = new Map<string, SourceAnalysis>();
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
      const text = await Deno.readTextFile(`${REPO_ROOT}${relativePath}`);
      // A file that never names a predicate or the flag cannot count; skip parsing it.
      if (!text.includes(FLAG) && ![...PREDICATES].some((name) => text.includes(name))) {
        continue;
      }
      try {
        sources.set(relativePath, analyzeSource(text, entry.name.endsWith(".tsx")));
      } catch (error) {
        throw new Error(`Could not parse ${relativePath}`, { cause: error });
      }
    }
  }
  for (const root of SCANNED_ROOTS) await walk(root);
  return sources;
}

let cachedSources: Promise<Map<string, SourceAnalysis>> | undefined;
function sources(): Promise<Map<string, SourceAnalysis>> {
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
      .filter(([path, analysis]) =>
        analysis.guards > 0 && !(path in GUARDED_SURFACES) &&
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
        const analysis = all.get(path);
        // Local-project checks add to the canonical count; they never replace it.
        const found = analysis === undefined
          ? "missing file"
          : analysis.guards + (entry.countLocalProjectChecks ? analysis.localProjectChecks : 0);
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
        .map(([path, analysis]) => [path, analysis.grants] as const)
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

  it("counts guards only in code, not in comments, strings, templates or regular expressions", () => {
    const guards = (source: string) => analyzeSource(source, false).guards;
    const source = [
      "/*",
      "if (requiresIsolatedProjectRuntime(ctx)) return;",
      "*/",
      'const text = "/* not a comment */"; isSharedProjectRuntime(ctx);',
      "run(); // requiresIsolatedProjectRuntime(ctx)",
      'throw new Error("requiresIsolatedProjectRuntime( was removed");',
      "log(`isSharedProjectRuntime( ${requiresIsolatedProjectRuntime(ctx)} done`);",
    ].join("\n");
    // Counted: the call on line 4 and the call inside the template expression.
    assertEquals(guards(source), 2);
    // A quote inside a regular expression literal does not hide the code after it.
    assertEquals(
      guards(`const quoted = /["']/.test(value); allowHostProjectCodeExecution && run();`),
      1,
    );
    assertEquals(guards(`const pattern = /requiresIsolatedProjectRuntime\\(/;`), 0);
    // A regular expression after a control condition is still a regular expression.
    assertEquals(
      guards(`if (ready) /["']/.test(value); allowHostProjectCodeExecution && run();`),
      1,
    );
    // Division is not a regular expression.
    assertEquals(
      guards("const r = count(items) / 2; isSharedProjectRuntime(ctx); const q = a / b;"),
      1,
    );
  });

  it("counts every runtime use of the flag, not type annotations or class declarations", () => {
    const analysis = analyzeSource(
      [
        "const { allowHostProjectCodeExecution: allowed } = options;",
        "run({ allowHostProjectCodeExecution: options.allowHostProjectCodeExecution });",
        "if (!options?.allowHostProjectCodeExecution) stop();",
        "const flag = options.allowHostProjectCodeExecution === true ? 1 : 0;",
        "interface Options { allowHostProjectCodeExecution?: boolean }",
        "class Holder { readonly allowHostProjectCodeExecution: boolean = false; }",
        "const grant = { allowHostProjectCodeExecution: true };",
        "type Grant = { allowHostProjectCodeExecution: true };",
      ].join("\n"),
      false,
    );
    // Destructuring (1), propagation key and read (2), negation (1), comparison (1).
    assertEquals(analysis.guards, 5);
    assertEquals(analysis.grants, 2);
  });
});
