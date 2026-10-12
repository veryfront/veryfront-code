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
 *
 * Supported forms, and the only ones this test claims to see:
 * - direct predicate calls, including `receiver.predicate(...)` and calls through a
 *   fallback or wrapper such as `(override ?? predicate)()` or `(<T> predicate)()`,
 *   `predicate.call(...)` / `predicate.apply(...)` and tagged templates;
 * - predicates imported under another name (`import { p as q }`);
 * - local aliases (`const q = p`), member aliases (`const q = policy.p`) and
 *   destructured aliases (`const { p: q } = policy`), also through `as`, `satisfies`,
 *   `!` or parentheses, transitively;
 * - every runtime use of `allowHostProjectCodeExecution`, including negation and
 *   `=== true` / `!== true` comparisons, reads, destructuring and propagation keys;
 * - literal `allowHostProjectCodeExecution: true` grants in values and types, including
 *   `as` / `satisfies` assertion types, class fields and constructor parameter properties
 *   initialized to or typed as `true`, assignments of `true` (`=`, `||=`, `??=`),
 *   destructuring and parameter defaults of `true`, getters returning `true`, JSX props
 *   (`<C allowHostProjectCodeExecution />` or `={true}`), and `true` wrapped in `as const`,
 *   `<const>` or parentheses;
 * - TypeScript and JavaScript sources (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`).
 *
 * Dynamic or computed access (`policy[name]()`, alias reassignment, re-exports through
 * other modules) is out of scope: the runtime guards, not this test, enforce
 * isolation. This test only keeps the inventory of those guards honest.
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
  "isWorkerIsolationEnabled",
]);
const FLAG = "allowHostProjectCodeExecution";

/**
 * The operator-owned override that grants host execution. A file that names the constant
 * or the environment variable in code reads the grant directly instead of calling a
 * predicate. Each file and its number of code references is listed here by hand; comments
 * and longer strings that merely mention the name do not count.
 */
const OPERATOR_GATE_CONSTANT = "HOST_PROJECT_EXECUTION_OVERRIDE_ENV";
const OPERATOR_GATE_VARIABLE = "VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION";
const OPERATOR_GATE_READS: Record<string, number> = {
  // The definition, its literal, and the default read.
  "src/security/host-execution-policy.ts": 3,
  // Import (2 identifiers) and the name reported in diagnostics.
  "src/server/handlers/request/api/project-discovery.ts": 3,
  "src/server/production-server.ts": 3,
};

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
    guards: 11,
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
  "src/security/project-locality.ts": {
    surface: "Host execution capability predicates",
    guards: 3,
  },
  "src/security/sandbox/worker-pool.ts": {
    surface: "Worker realm selection",
    guards: 4,
  },
  "src/server/runtime-handler/project-isolation.ts": {
    surface: "Isolated project runtime selection",
    guards: 2,
  },
  "src/server/handlers/request/openapi.handler.ts": {
    surface: "Runtime OpenAPI generation",
    guards: 1,
    countLocalProjectChecks: true,
  },
};

interface SourceAnalysis {
  /** Predicate calls and uses of the capability flag in runtime code. */
  guards: number;
  /** Literal `allowHostProjectCodeExecution: true` grants, in values or types. */
  grants: number;
  /** `isLocalProject !== true` checks. */
  localProjectChecks: number;
  /** Code references to the operator execution override constant or variable. */
  gateReads: number;
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
  "TSTypeLiteral",
]);

function isNode(value: unknown): value is SyntaxNode {
  return value !== null && typeof value === "object" &&
    typeof (value as SyntaxNode).type === "string";
}

function nameOf(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "Identifier") return node.name as string;
  if (node.type === "StringLiteral") return node.value as string;
  // A private name `#check` keeps its `#`, so it never collides with a public `check`.
  if (node.type === "PrivateName") {
    const name = nameOf(node.id);
    return name === undefined ? undefined : `#${name}`;
  }
  return undefined;
}

/** A property name written as an identifier, a string, or a computed string literal. */
function propertyName(key: unknown, computed: unknown): string | undefined {
  if (!computed) return nameOf(key);
  if (isNode(key) && key.type === "StringLiteral") return key.value as string;
  if (
    isNode(key) && key.type === "TemplateLiteral" && Array.isArray(key.expressions) &&
    key.expressions.length === 0 && Array.isArray(key.quasis)
  ) {
    return (key.quasis[0] as { value?: { cooked?: string } } | undefined)?.value?.cooked;
  }
  return undefined;
}

/** The expression inside parentheses and type-only wrappers such as `as const` or `!`. */
function unwrapExpression(node: unknown): unknown {
  while (
    isNode(node) &&
    (node.type === "ParenthesizedExpression" || node.type === "TSAsExpression" ||
      node.type === "TSSatisfiesExpression" || node.type === "TSTypeAssertion" ||
      node.type === "TSNonNullExpression")
  ) node = node.expression;
  return node;
}

/** The function `f.bind(...)` binds, when `node` is such a call. */
function boundFunction(node: unknown): unknown {
  const call = unwrapExpression(node);
  if (
    !isNode(call) || (call.type !== "CallExpression" && call.type !== "OptionalCallExpression")
  ) return undefined;
  const callee = unwrapExpression(call.callee);
  if (
    !isNode(callee) ||
    (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") ||
    propertyName(callee.property, callee.computed) !== "bind"
  ) return undefined;
  return callee.object;
}

/**
 * A value that can evaluate to a literal `true`: `true` itself, also through
 * `true as const`, `<const>true` or parentheses, and any branch of a fallback such as
 * `configured ?? true`, `flag ? true : false` or `(audit(), true)`.
 */
function isTrue(node: unknown): boolean {
  const value = unwrapExpression(node);
  if (!isNode(value)) return false;
  switch (value.type) {
    case "BooleanLiteral":
      return value.value === true;
    case "LogicalExpression":
      // `a && true` yields its right side; `a ?? true` and `a || true` may yield either.
      return isTrue(value.right) || (value.operator !== "&&" && isTrue(value.left));
    case "ConditionalExpression":
      return isTrue(value.consequent) || isTrue(value.alternate);
    case "SequenceExpression":
      return Array.isArray(value.expressions) && isTrue(value.expressions.at(-1));
    default:
      return false;
  }
}

const FUNCTION_NODES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

/** Whether a function body has a `return` of a value that can be a literal true. */
function returnsTrue(body: unknown): boolean {
  if (!isNode(body)) return false;
  if (body.type === "ReturnStatement") return isTrue(body.argument);
  for (const [key, value] of Object.entries(body)) {
    if (SKIPPED_KEYS.has(key)) continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      // A nested function's returns are its own.
      if (isNode(child) && !FUNCTION_NODES.has(child.type) && returnsTrue(child)) return true;
    }
  }
  return false;
}

/**
 * The names a call may resolve to: `p()`, `receiver.p()`, and every branch of a fallback
 * such as `(override ?? p)()`, `(flag ? p : q)()`, `(0, p)()` or `p!()`.
 */
function calleeNames(callee: unknown): string[] {
  if (!isNode(callee)) return [];
  switch (callee.type) {
    case "Identifier":
      return [callee.name as string];
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const name = propertyName(callee.property, callee.computed);
      // `predicate.call(thisArg, ctx)` and `predicate.apply(thisArg, [ctx])` call it.
      const through = name === "call" || name === "apply" ? calleeNames(callee.object) : [];
      return name === undefined ? through : [name, ...through];
    }
    case "CallExpression":
    case "OptionalCallExpression": {
      // `predicate.bind(thisArg)(ctx)` calls the bound predicate.
      const bound = boundFunction(callee);
      return bound === undefined ? [] : calleeNames(bound);
    }
    case "LogicalExpression":
      return [...calleeNames(callee.left), ...calleeNames(callee.right)];
    case "ConditionalExpression":
      return [...calleeNames(callee.consequent), ...calleeNames(callee.alternate)];
    case "SequenceExpression":
      return Array.isArray(callee.expressions) ? calleeNames(callee.expressions.at(-1)) : [];
    case "ParenthesizedExpression":
    case "TSNonNullExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
      return calleeNames(callee.expression);
    default:
      return [];
  }
}

/**
 * The predicate names plus every local alias of one in this file: `import { p as q }`,
 * `const q = p`, `const { p: q } = module`, a default `(q = p) => ...` and a later
 * `q = p`. Aliases of aliases resolve too.
 */
function predicateAliases(program: SyntaxNode): Set<string> {
  const names = new Set(PREDICATES);
  const links: Array<[from: string, to: string]> = [];
  const collect = (node: SyntaxNode): void => {
    if (node.type === "ImportSpecifier") {
      const imported = nameOf(node.imported);
      const local = nameOf(node.local);
      if (imported !== undefined && local !== undefined) links.push([imported, local]);
    } else if (
      (node.type === "AssignmentPattern" || node.type === "AssignmentExpression") &&
      isNode(node.left) && node.left.type === "Identifier"
    ) {
      // A parameter or destructuring default `(check = p) => ...`, or a later `check = p`,
      // through the same wrappers, binds and fallbacks a direct call resolves.
      for (const from of calleeNames(node.right)) links.push([from, node.left.name as string]);
    } else if (
      node.type === "AssignmentExpression" && isNode(node.left) &&
      (node.left.type === "MemberExpression" || node.left.type === "OptionalMemberExpression")
    ) {
      // `policy.check = p` or `this.#check = p`: a later call of that property calls it.
      const key = propertyName(node.left.property, node.left.computed);
      if (key !== undefined) {
        for (const from of calleeNames(node.right)) links.push([from, key]);
      }
    } else if (node.type === "ObjectExpression" && Array.isArray(node.properties)) {
      // `{ check: p }`: a later `policy.check(ctx)` calls the predicate.
      for (const property of node.properties) {
        if (!isNode(property) || property.type !== "ObjectProperty") continue;
        const key = propertyName(property.key, property.computed);
        if (key === undefined) continue;
        for (const from of calleeNames(property.value)) links.push([from, key]);
      }
    } else if (
      node.type === "ClassProperty" || node.type === "ClassPrivateProperty" ||
      node.type === "ClassAccessorProperty"
    ) {
      // `class Policy { check = p }` and `static check = p`.
      const key = propertyName(node.key, node.computed);
      if (key !== undefined) {
        for (const from of calleeNames(node.value)) links.push([from, key]);
      }
    } else if (node.type === "VariableDeclarator" && isNode(node.id)) {
      // `const q = p as Guard`, `const q = (policy.p)!`: aliases through transparent wrappers.
      // Also `const check = policy.p`, `p.bind(policy)` and every branch of a fallback
      // such as `override ?? p`: the names a call of the initializer may resolve to.
      if (node.id.type === "Identifier") {
        for (const from of calleeNames(node.init)) links.push([from, node.id.name as string]);
      } else if (node.id.type === "ObjectPattern" && Array.isArray(node.id.properties)) {
        for (const property of node.id.properties) {
          if (!isNode(property) || property.type !== "ObjectProperty") continue;
          const key = propertyName(property.key, property.computed);
          const value = isNode(property.value) && property.value.type === "AssignmentPattern"
            ? property.value.left
            : property.value;
          const local = isNode(value) && value.type === "Identifier"
            ? value.name as string
            : undefined;
          if (key !== undefined && local !== undefined) links.push([key, local]);
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (SKIPPED_KEYS.has(key)) continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) collect(item);
      } else if (isNode(value)) {
        collect(value);
      }
    }
  };
  collect(program);
  for (let changed = true; changed;) {
    changed = false;
    for (const [from, to] of links) {
      if (names.has(from) && !names.has(to)) {
        names.add(to);
        changed = true;
      }
    }
  }
  return names;
}

/**
 * Count guards and grants in one source file from its syntax tree. Runtime code counts
 * every call of a predicate and every use of the flag: reads on any receiver, negations,
 * comparisons, conditions, destructuring and propagation keys. Class property
 * declarations and type positions are not uses. A property `allowHostProjectCodeExecution:
 * true`, in a value or a type, is a literal grant.
 */
function analyzeSource(source: string, language: "ts" | "tsx" | "js" = "ts"): SourceAnalysis {
  const shared = ["decorators-legacy", "decoratorAutoAccessors", "importAttributes"] as const;
  const ast = parse(source, {
    sourceType: language === "js" ? "unambiguous" : "module",
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    errorRecovery: false,
    plugins: language === "ts"
      ? ["typescript", ...shared]
      : language === "tsx"
      ? ["typescript", "jsx", ...shared]
      : ["jsx", ...shared],
  });
  const result: SourceAnalysis = { guards: 0, grants: 0, localProjectChecks: 0, gateReads: 0 };
  const predicates = predicateAliases(ast.program as unknown as SyntaxNode);

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
        node.type === "TSPropertySignature" && propertyName(node.key, node.computed) === FLAG &&
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
        if (calleeNames(node.callee).some((name) => predicates.has(name))) result.guards++;
        break;
      }
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSTypeAssertion":
        // `value as { allowHostProjectCodeExecution: true }`: the expression is code, the
        // asserted type is a type position.
        if (isNode(node.expression)) visit(node.expression, false);
        if (isNode(node.typeAnnotation)) visit(node.typeAnnotation, true);
        return;
      case "Identifier":
        if (node.name === FLAG) result.guards++;
        // The constant, or the variable read by name as `process.env.VERYFRONT_...`.
        if (node.name === OPERATOR_GATE_CONSTANT || node.name === OPERATOR_GATE_VARIABLE) {
          result.gateReads++;
        }
        break;
      case "StringLiteral":
        if (node.value === OPERATOR_GATE_VARIABLE) result.gateReads++;
        break;
      case "MemberExpression":
      case "OptionalMemberExpression":
        // `options["allowHostProjectCodeExecution"]` is a read like `options.allowHost...`.
        if (node.computed && propertyName(node.property, true) === FLAG) result.guards++;
        break;
      case "ObjectProperty":
        if (propertyName(node.key, node.computed) === FLAG) {
          // `{ allowHostProjectCodeExecution: true }`, or a destructuring default
          // `{ allowHostProjectCodeExecution = true }` that grants when the option is absent.
          if (
            isTrue(node.value) ||
            (isNode(node.value) && node.value.type === "AssignmentPattern" &&
              isTrue(node.value.right))
          ) {
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
      case "JSXAttribute":
        // `<Runtime allowHostProjectCodeExecution />` or `={true}` is a grant; any other
        // value is a use.
        if (isNode(node.name) && node.name.type === "JSXIdentifier" && node.name.name === FLAG) {
          const value = node.value;
          const expression = isNode(value) && value.type === "JSXExpressionContainer"
            ? value.expression
            : undefined;
          if (value === null || value === undefined || isTrue(expression)) {
            result.grants++;
            return;
          }
          result.guards++;
          if (isNode(value)) visit(value, false);
          return;
        }
        break;
      case "TaggedTemplateExpression":
        if (calleeNames(node.tag).some((name) => predicates.has(name))) result.guards++;
        break;
      case "ObjectMethod":
      case "ClassMethod":
      case "ClassPrivateMethod":
        // A getter `get allowHostProjectCodeExecution() { return true; }` is a grant; any
        // other accessor or method of that name is a use.
        if (propertyName(node.key, node.computed) === FLAG) {
          // Any return of a literal true grants, whatever else the body does.
          if (node.kind === "get" && returnsTrue(node.body)) result.grants++;
          else result.guards++;
          visitChildren(node, false, node.key);
          return;
        }
        break;
      case "VariableDeclarator":
        // `const allowHostProjectCodeExecution = true` feeds a later shorthand
        // `{ allowHostProjectCodeExecution }`; the initialization is the grant.
        if (nameOf(node.id) === FLAG && isTrue(node.init)) {
          result.grants++;
          return;
        }
        break;
      case "AssignmentPattern":
        // A parameter default `(allowHostProjectCodeExecution = true) => ...` is a grant.
        if (nameOf(node.left) === FLAG && isTrue(node.right)) {
          result.grants++;
          return;
        }
        break;
      case "AssignmentExpression": {
        // `options.allowHostProjectCodeExecution = true` (also `||=` / `??=`) is a grant.
        const target = node.left;
        const assigned = isNode(target) &&
            (target.type === "MemberExpression" || target.type === "OptionalMemberExpression")
          ? propertyName(target.property, target.computed)
          : nameOf(target);
        if (
          assigned === FLAG && ["=", "||=", "??="].includes(node.operator as string) &&
          isTrue(node.right)
        ) {
          result.grants++;
          if (isNode(target) && target.type !== "Identifier") {
            // The receiver is still code: `get().allowHostProjectCodeExecution = true`.
            if (isNode(target.object)) visit(target.object, false);
          }
          return;
        }
        break;
      }
      case "TSParameterProperty": {
        // `constructor(public allowHostProjectCodeExecution = true)` declares a field like
        // a class property: a literal `true` default is a grant, a declaration is not a use.
        const parameter = node.parameter;
        const declared = isNode(parameter) && parameter.type === "AssignmentPattern"
          ? parameter.left
          : parameter;
        if (nameOf(declared) === FLAG) {
          // `public allowHostProjectCodeExecution: true` is a literal grant in a type.
          const annotation = isNode(declared) && isNode(declared.typeAnnotation)
            ? declared.typeAnnotation.typeAnnotation
            : undefined;
          if (
            isNode(annotation) && annotation.type === "TSLiteralType" && isTrue(annotation.literal)
          ) {
            result.grants++;
            return;
          }
          if (isNode(parameter) && parameter.type === "AssignmentPattern") {
            if (isTrue(parameter.right)) {
              result.grants++;
              return;
            }
            if (isNode(parameter.right)) visit(parameter.right, false);
          }
          return;
        }
        break;
      }
      case "ClassProperty":
      case "ClassAccessorProperty":
        if (propertyName(node.key, node.computed) === FLAG) {
          // `allowHostProjectCodeExecution = true` on a class is a literal grant; any
          // other declaration is not a use, but its initializer is still code.
          // So is a `declare` or `abstract` field typed as the literal `true`.
          const annotation = isNode(node.typeAnnotation)
            ? node.typeAnnotation.typeAnnotation
            : undefined;
          if (
            isTrue(node.value) ||
            (isNode(annotation) && annotation.type === "TSLiteralType" &&
              isTrue(annotation.literal))
          ) {
            result.grants++;
            return;
          }
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
        !/\.[cm]?[jt]sx?$/.test(entry.name) ||
        /\.(?:test|test-helpers)\.[cm]?[jt]sx?$/.test(entry.name) ||
        entry.name.endsWith(".d.ts")
      ) continue;
      const text = await Deno.readTextFile(`${REPO_ROOT}${relativePath}`);
      // A file that never names a predicate or the flag cannot count; skip parsing it.
      if (
        !text.includes(FLAG) && !text.includes(OPERATOR_GATE_CONSTANT) &&
        !text.includes(OPERATOR_GATE_VARIABLE) &&
        ![...PREDICATES].some((name) => text.includes(name))
      ) {
        continue;
      }
      try {
        const language = /\.[cm]?jsx?$/.test(entry.name)
          ? "js"
          : entry.name.endsWith(".tsx")
          ? "tsx"
          : "ts";
        sources.set(relativePath, analyzeSource(text, language));
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
      .filter(([path, analysis]) => analysis.guards > 0 && !(path in GUARDED_SURFACES))
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
    const guards = (source: string) => analyzeSource(source).guards;
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

  it("counts calls of a predicate through an import or local alias", () => {
    const guards = (source: string) => analyzeSource(source).guards;
    assertEquals(
      guards(
        [
          'import { requiresIsolatedProjectRuntime as needsIsolation } from "./policy.ts";',
          "if (needsIsolation(ctx)) stop();",
          "const check = needsIsolation;",
          "check(ctx);",
          "const { isSharedProjectRuntime: shared = fallback } = policy;",
          "shared(ctx);",
          "policy.isHostRealmApiExecution(ctx);",
          "const member = policy.isHostProjectCodeExecutionAllowed;",
          "member(ctx);",
          "const optional = policy?.isSharedProjectRuntime;",
          "optional(ctx);",
          "const { requiresIsolatedProjectRuntime: destructured } = policy;",
          "destructured(ctx);",
        ].join("\n"),
      ),
      7,
    );
    // A predicate reached through a fallback or wrapper is still a call of it.
    assertEquals(
      guards(
        [
          "(dependencies.isOverrideEnabled ?? isHostProjectExecutionOverrideEnabled)();",
          "(useFake ? fake : requiresIsolatedProjectRuntime)(ctx);",
          "(0, isSharedProjectRuntime)(ctx);",
          "policy.isHostRealmApiExecution!(true);",
          "(<typeof requiresIsolatedProjectRuntime> requiresIsolatedProjectRuntime)(ctx);",
          "isSharedProjectRuntime.call(undefined, ctx);",
          "policy.isHostRealmApiExecution.apply(policy, [true]);",
          "requiresIsolatedProjectRuntime`tagged`;",
          "const asserted = policy.requiresIsolatedProjectRuntime as Guard;",
          "asserted(ctx);",
          "const wrapped = (isSharedProjectRuntime)!;",
          "wrapped(ctx);",
        ].join("\n"),
      ),
      10,
    );
    // An unrelated local with an unrelated name stays uncounted.
    assertEquals(guards('import { other as needsIsolation } from "./x.ts"; needsIsolation();'), 0);
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
        'const quoted = { "allowHostProjectCodeExecution": true };',
        'const computed = { ["allowHostProjectCodeExecution"]: true };',
        'if (options["allowHostProjectCodeExecution"]) run();',
        'const asserted = value as { "allowHostProjectCodeExecution": true };',
        "const satisfied = value satisfies { allowHostProjectCodeExecution: true };",
        "const read = (options as Options).allowHostProjectCodeExecution;",
        "class Granting { allowHostProjectCodeExecution = true; }",
        "class Accessor { accessor allowHostProjectCodeExecution = true; }",
        "class Denying { allowHostProjectCodeExecution = false; }",
        "class AsConst { allowHostProjectCodeExecution = true as const; }",
        "class Angle { allowHostProjectCodeExecution = <const> true; }",
        "class Parameter { constructor(public allowHostProjectCodeExecution = true) {} }",
        "class ParameterOff { constructor(readonly allowHostProjectCodeExecution = false) {} }",
        "class ParameterType { constructor(public allowHostProjectCodeExecution: true) {} }",
        "class ParameterBool { constructor(public allowHostProjectCodeExecution: boolean) {} }",
        "class Declared { declare readonly allowHostProjectCodeExecution: true; }",
        "abstract class Contract { abstract allowHostProjectCodeExecution: true; }",
        "class Typed { allowHostProjectCodeExecution: boolean = false; }",
        "options.allowHostProjectCodeExecution = true;",
        'settings["allowHostProjectCodeExecution"] ??= true;',
        "const { allowHostProjectCodeExecution = true } = input;",
        "const { allowHostProjectCodeExecution: enabled = true } = input;",
        "function grantByDefault(allowHostProjectCodeExecution = true) {}",
        "options.allowHostProjectCodeExecution = false;",
        "const getter = { get allowHostProjectCodeExecution() { return true; } };",
        "class Getter { get allowHostProjectCodeExecution() { return true; } }",
        "class Computed { get allowHostProjectCodeExecution() { return compute(); } }",
        "const constGrant = { allowHostProjectCodeExecution: true as const };",
      ].join("\n"),
    );
    // Destructuring (1), propagation key and read (2), negation (1), comparison (1),
    // computed read (1), read through an assertion (1), assignment of `false` (1), a
    // computed getter (1).
    assertEquals(analysis.guards, 9);
    // Identifier, type, quoted and computed keys, `as` / `satisfies` assertion types, class
    // and accessor fields initialized to `true` (also `as const` and `<const>`), a
    // constructor parameter property defaulting to or typed as `true`, `declare` and
    // `abstract` fields typed as `true`, `true as const` in a value, assignments of `true`
    // (`=` and `??=`), destructuring defaults (2), a parameter default, and getters
    // returning `true` (2).
    assertEquals(analysis.grants, 22);
  });

  it("counts predicates called through bind, directly or by a stored callback", () => {
    const analysis = analyzeSource(
      [
        "requiresIsolatedProjectRuntime.bind(undefined)(ctx);",
        "const check = policy.isSharedProjectRuntime.bind(policy);",
        "check(ctx);",
      ].join("\n"),
      "ts",
    );
    assertEquals(analysis.guards, 2);
  });

  it("resolves predicate aliases from parameter defaults and assignments", () => {
    const analysis = analyzeSource(
      [
        "function run(check = requiresIsolatedProjectRuntime) { return check(ctx); }",
        "let later;",
        "later = policy.isSharedProjectRuntime;",
        "later(ctx);",
      ].join("\n"),
      "ts",
    );
    // `check(ctx)` and `later(ctx)`.
    assertEquals(analysis.guards, 2);
  });

  it("resolves predicate aliases initialized through fallbacks", () => {
    const analysis = analyzeSource(
      [
        "const first = override ?? requiresIsolatedProjectRuntime;",
        "first(ctx);",
        "const second = flag ? policy.isSharedProjectRuntime : other;",
        "second(ctx);",
        "let third;",
        "third = (0, requiresIsolatedProjectRuntime);",
        "third(ctx);",
        "function run(fourth = injected || isSharedProjectRuntime.bind(policy)) {",
        "  return fourth(ctx);",
        "}",
      ].join("\n"),
      "ts",
    );
    // `first(ctx)`, `second(ctx)`, `third(ctx)` and `fourth(ctx)`.
    assertEquals(analysis.guards, 4);
  });

  it("resolves predicate aliases stored as object or class properties", () => {
    const analysis = analyzeSource(
      [
        "const policy = { check: requiresIsolatedProjectRuntime, other: unrelated };",
        "policy.check(ctx);",
        "class Policy { static verify = override ?? isSharedProjectRuntime; }",
        "Policy.verify(ctx);",
        "policy.other(ctx);",
      ].join("\n"),
      "ts",
    );
    // `policy.check(ctx)` and `Policy.verify(ctx)`; `other` is not a predicate.
    assertEquals(analysis.guards, 2);
  });

  it("resolves predicate aliases in private fields and property assignments", () => {
    const analysis = analyzeSource(
      [
        "class Policy {",
        "  #check = requiresIsolatedProjectRuntime;",
        "  run(ctx) { return this.#check(ctx); }",
        "}",
        "policy.verify = isSharedProjectRuntime;",
        "policy.verify(ctx);",
        "policy.check(ctx);",
      ].join("\n"),
      "ts",
    );
    // `this.#check(ctx)` and `policy.verify(ctx)`; a public `check` is not the private one.
    assertEquals(analysis.guards, 2);
  });

  it("counts a dot-property read of the operator gate variable", () => {
    const analysis = analyzeSource(
      [
        "const direct = process.env.VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION;",
        'const quoted = process.env["VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION"];',
        "const named = read(HOST_PROJECT_EXECUTION_OVERRIDE_ENV);",
      ].join("\n"),
      "ts",
    );
    assertEquals(analysis.gateReads, 3);
  });

  it("counts a true-initialized binding passed by shorthand as a grant", () => {
    const analysis = analyzeSource(
      [
        "const allowHostProjectCodeExecution = true;",
        "run({ allowHostProjectCodeExecution });",
        "let other = false;",
      ].join("\n"),
      "ts",
    );
    // The initialization is the grant; the shorthand property is one use.
    assertEquals(analysis.grants, 1);
    assertEquals(analysis.guards, 1);
  });

  it("counts a value that can fall back to true as a grant", () => {
    const analysis = analyzeSource(
      [
        "run({ allowHostProjectCodeExecution: configured ?? true });",
        "run({ allowHostProjectCodeExecution: configured || (true as const) });",
        "run({ allowHostProjectCodeExecution: trusted ? true : false });",
        "const allowHostProjectCodeExecution = (audit(), true);",
        "run({ allowHostProjectCodeExecution: configured ?? false });",
      ].join("\n"),
      "ts",
    );
    // The first four can evaluate to a literal true; the last cannot.
    assertEquals(analysis.grants, 4);
  });

  it("counts a getter with any true return as a grant", () => {
    const analysis = analyzeSource(
      [
        "const audited = { get allowHostProjectCodeExecution() { audit(); return true; } };",
        "class Branching {",
        "  get allowHostProjectCodeExecution() {",
        "    if (this.locked) return false;",
        "    return true;",
        "  }",
        "}",
        "class Nested {",
        "  get allowHostProjectCodeExecution() {",
        "    const inner = () => { return true; };",
        "    return inner();",
        "  }",
        "}",
      ].join("\n"),
      "ts",
    );
    // The first two getters can return a literal true. The third returns a computed
    // value; the `true` belongs to a nested function.
    assertEquals(analysis.grants, 2);
    assertEquals(analysis.guards, 1);
  });

  it("parses JavaScript sources, including JSX", () => {
    const analysis = analyzeSource(
      [
        "const view = <Page allowed={options.allowHostProjectCodeExecution} />;",
        "if (requiresIsolatedProjectRuntime(ctx)) stop();",
        "module.exports = { allowHostProjectCodeExecution: true };",
        "const bare = <Runtime allowHostProjectCodeExecution />;",
        "const literal = <Runtime allowHostProjectCodeExecution={true} />;",
        "const passed = <Runtime allowHostProjectCodeExecution={enabled} />;",
        "const off = <Runtime allowHostProjectCodeExecution={false} />;",
      ].join("\n"),
      "js",
    );
    // Member read, predicate call, and JSX props with a non-literal-true value (2).
    assertEquals(analysis.guards, 4);
    // Object property, bare JSX prop, and JSX prop set to `true`.
    assertEquals(analysis.grants, 3);
  });

  it("counts every code reference to the operator execution override", async () => {
    const all = await sources();
    const found = Object.fromEntries(
      [...all.entries()]
        .filter(([, analysis]) => analysis.gateReads > 0)
        .map(([path, analysis]) => [path, analysis.gateReads] as const)
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    assertEquals(
      found,
      OPERATOR_GATE_READS,
      "A file references the operator execution override in code a different number of " +
        "times than OPERATOR_GATE_READS records. Review each read, then update the entry.",
    );
  });
});
