import { BabelParseOnlyParser } from "../../extensions/ext-parser-babel/src/parser-only.ts";
import { dirname, isAbsolute, relative, resolve, SEPARATOR } from "#std/path";

interface AstNode {
  type: string;
  [key: string]: unknown;
}

function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && "type" in value &&
    typeof value.type === "string";
}

function literal(value: unknown): string | undefined {
  if (!isNode(value)) return undefined;
  if (value.type === "StringLiteral" && typeof value.value === "string") {
    return value.value;
  }
  if (
    value.type === "TemplateLiteral" && Array.isArray(value.expressions) &&
    value.expressions.length === 0 && Array.isArray(value.quasis) &&
    value.quasis.length === 1
  ) {
    const quasi = value.quasis[0];
    if (
      isNode(quasi) && typeof quasi.value === "object" &&
      quasi.value !== null &&
      "cooked" in quasi.value && typeof quasi.value.cooked === "string"
    ) {
      return quasi.value.cooked;
    }
  }
  return undefined;
}

function children(node: AstNode): AstNode[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === "loc" || key.endsWith("Comments") || key === "comments") {
      return [];
    }
    return Array.isArray(value)
      ? value.filter(isNode)
      : isNode(value)
      ? [value]
      : [];
  });
}

function memberName(node: unknown): string | undefined {
  if (
    !isNode(node) ||
    (node.type !== "MemberExpression" &&
      node.type !== "OptionalMemberExpression")
  ) return undefined;
  if (node.computed === true) return literal(node.property);
  return isNode(node.property) && node.property.type === "Identifier" &&
      typeof node.property.name === "string"
    ? node.property.name
    : undefined;
}

function isImportMeta(node: unknown): boolean {
  return isNode(node) && node.type === "MetaProperty" && isNode(node.meta) &&
    node.meta.name === "import" && isNode(node.property) &&
    node.property.name === "meta";
}

function isModuleMeta(
  node: unknown,
  bindings: ReadonlyMap<string, unknown>,
): boolean {
  if (isImportMeta(node)) return true;
  if (bindings.has("globalThis") || bindings.has("Symbol")) return false;
  // DNT wraps import.meta with this exact runtime ponyfill.
  if (
    !isNode(node) || node.type !== "CallExpression" ||
    !Array.isArray(node.arguments) || node.arguments.length !== 1 ||
    !isImportMeta(node.arguments[0]) || !isNode(node.callee) ||
    node.callee.type !== "MemberExpression" || node.callee.computed !== true ||
    !isNode(node.callee.object) || node.callee.object.name !== "globalThis"
  ) return false;
  const selector = node.callee.property;
  return isNode(selector) && selector.type === "CallExpression" &&
    memberName(selector.callee) === "for" && isNode(selector.callee) &&
    isNode(selector.callee.object) &&
    selector.callee.object.name === "Symbol" &&
    Array.isArray(selector.arguments) && selector.arguments.length === 1 &&
    literal(selector.arguments[0]) === "import-meta-ponyfill-esmodule";
}

type Selector =
  | { kind: "strings"; values: string[] }
  | { kind: "module-url" }
  | { kind: "external-url" };

async function localReferences(
  source: string,
  modulePath: string,
): Promise<string[] | undefined> {
  let program: AstNode;
  const declarationReferences: string[] = [];
  try {
    const ast = await new BabelParseOnlyParser().parse({
      code: source,
      filePath: modulePath,
    });
    if (!isNode(ast.program)) return undefined;
    program = ast.program;
    if (Array.isArray(ast.comments)) {
      for (const comment of ast.comments) {
        if (
          !isNode(comment) || comment.type !== "CommentLine" ||
          typeof comment.value !== "string"
        ) continue;
        const path = comment.value.match(
          /^\s*\/\s*<reference\s+path\s*=\s*["']([^"']+)["']/,
        )?.[1];
        if (path !== undefined) {
          if (path.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(path)) {
            return undefined;
          }
          declarationReferences.push(path.startsWith(".") ? path : `./${path}`);
        }
      }
    }
  } catch {
    return undefined;
  }

  // Only globally unique immutable bindings are resolved. Shadowing, mutation,
  // destructuring and unknown expressions make selectors uncertain.
  const constants = new Map<string, unknown>();
  const binding = (node: unknown, initializer?: unknown): void => {
    if (!isNode(node)) return;
    if (node.type === "Identifier" && typeof node.name === "string") {
      constants.set(
        node.name,
        constants.has(node.name) ? undefined : initializer,
      );
    } else {
      for (const child of children(node)) binding(child);
    }
  };
  const collect = (node: AstNode): void => {
    if (
      node.type === "VariableDeclaration" && Array.isArray(node.declarations)
    ) {
      for (const declaration of node.declarations) {
        if (isNode(declaration)) {
          binding(
            declaration.id,
            node.kind === "const" ? declaration.init : undefined,
          );
        }
      }
    } else if (node.type.includes("Function")) {
      binding(node.id);
    } else if (node.type.startsWith("Class")) {
      binding(node.id);
    } else if (
      node.type.startsWith("Import") && node.type.endsWith("Specifier")
    ) {
      binding(node.local);
    } else if (node.type === "CatchClause") {
      binding(node.param);
    } else if (
      node.type === "AssignmentExpression" || node.type === "UpdateExpression"
    ) {
      binding(node.left ?? node.argument);
    }
    if (Array.isArray(node.params)) {
      node.params.forEach((param) => binding(param));
    }
    for (const child of children(node)) collect(child);
  };
  collect(program);

  const resolveSelector = (
    node: unknown,
    resolving = new Set<string>(),
  ): Selector | undefined => {
    const value = literal(node);
    if (value !== undefined) return { kind: "strings", values: [value] };
    if (!isNode(node)) return undefined;
    if (node.type === "Identifier" && typeof node.name === "string") {
      if (resolving.has(node.name)) return undefined;
      return resolveSelector(
        constants.get(node.name),
        new Set([...resolving, node.name]),
      );
    }
    if (node.type === "ConditionalExpression") {
      const test = node.test;
      if (
        isNode(test) && test.type === "CallExpression" &&
        memberName(test.callee) === "endsWith" && isNode(test.callee) &&
        Array.isArray(test.arguments) && test.arguments.length === 1
      ) {
        const suffix = literal(test.arguments[0]);
        const receiver = resolveSelector(test.callee.object, resolving);
        if (suffix !== undefined && receiver?.kind === "module-url") {
          return resolveSelector(
            modulePath.endsWith(suffix) ? node.consequent : node.alternate,
            resolving,
          );
        }
      }
      const consequent = resolveSelector(node.consequent, resolving);
      const alternate = resolveSelector(node.alternate, resolving);
      if (consequent?.kind === "strings" && alternate?.kind === "strings") {
        return {
          kind: "strings",
          values: [...consequent.values, ...alternate.values],
        };
      }
      return consequent?.kind === "external-url" &&
          alternate?.kind === "external-url"
        ? consequent
        : undefined;
    }
    if (node.type === "MemberExpression") {
      if (memberName(node) === "url" && isModuleMeta(node.object, constants)) {
        return { kind: "module-url" };
      }
      if (memberName(node) === "href") {
        return resolveSelector(node.object, resolving);
      }
    }
    if (
      node.type === "CallExpression" && memberName(node.callee) === "resolve" &&
      isNode(node.callee) && isModuleMeta(node.callee.object, constants) &&
      Array.isArray(node.arguments) && node.arguments.length === 1
    ) {
      const specifier = literal(node.arguments[0]);
      if (specifier === undefined) return undefined;
      if (specifier.startsWith("/") || /^file:/i.test(specifier)) {
        return undefined;
      }
      return specifier.startsWith("./") || specifier.startsWith("../")
        ? { kind: "strings", values: [specifier] }
        : { kind: "external-url" };
    }
    if (
      node.type === "NewExpression" && isNode(node.callee) &&
      node.callee.type === "Identifier" && node.callee.name === "URL" &&
      Array.isArray(node.arguments)
    ) {
      if (constants.has("URL")) return undefined;
      const selector = resolveSelector(node.arguments[0], resolving);
      const base = resolveSelector(node.arguments[1], resolving);
      if (selector?.kind !== "strings") return undefined;
      if (base?.kind === "external-url") return base;
      if (
        selector.values.some((item) =>
          item.startsWith("/") || /^file:/i.test(item)
        )
      ) return undefined;
      if (base?.kind === "module-url") {
        return {
          kind: "strings",
          values: selector.values.map((item) =>
            /^[a-z][a-z\d+.-]*:/i.test(item) || item.startsWith("./") ||
              item.startsWith("../")
              ? item
              : `./${item}`
          ),
        };
      }
      if (selector.values.every((item) => /^[a-z][a-z\d+.-]*:/i.test(item))) {
        return { kind: "external-url" };
      }
    }
    return undefined;
  };

  const references: string[] = [...declarationReferences];
  let uncertain = false;
  const add = (node: unknown) => {
    const selector = resolveSelector(node);
    if (selector === undefined || selector.kind === "module-url") {
      uncertain = true;
    } else if (selector.kind === "strings") {
      references.push(
        ...selector.values.filter((value) =>
          value.startsWith("./") || value.startsWith("../")
        ),
      );
    }
  };
  const visit = (node: AstNode): void => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      node.type === "ExportNamedDeclaration"
    ) {
      if (node.source !== null && node.source !== undefined) add(node.source);
    } else if (node.type === "TSImportType") {
      add(node.argument);
    } else if (node.type === "ImportExpression") {
      add(node.source);
    } else if (
      (node.type === "CallExpression" ||
        node.type === "OptionalCallExpression") &&
      isNode(node.callee) &&
      (node.callee.type === "Import" ||
        (node.callee.type === "Identifier" && node.callee.name === "require"))
    ) {
      add(Array.isArray(node.arguments) ? node.arguments[0] : undefined);
    } else if (
      node.type === "NewExpression" && isNode(node.callee) &&
      node.callee.type === "Identifier" && node.callee.name === "URL" &&
      Array.isArray(node.arguments) && node.arguments.length > 1
    ) {
      add(node);
    } else if (
      (node.type === "CallExpression" ||
        node.type === "OptionalCallExpression") &&
      memberName(node.callee) === "resolve" &&
      Array.isArray(node.arguments)
    ) {
      const specifier = literal(node.arguments[0]);
      if (specifier?.startsWith("./") || specifier?.startsWith("../")) {
        // require.resolve and other resolver functions can load local assets.
        // Keep output unless the receiver is the exact module resolver.
        add(node);
      }
    } else if (
      memberName(node) === "resolve" && isNode(node.object) &&
      node.object.type === "Identifier" && node.object.name === "require"
    ) {
      // Accesses through call/apply/bind and aliases still select local assets.
      uncertain = true;
    } else if (
      node.type === "CallExpression" && isNode(node.callee) &&
      node.callee.type === "Identifier" && node.callee.name === "eval"
    ) {
      uncertain = true;
    }
    for (const child of children(node)) visit(child);
  };
  visit(program);
  return uncertain ? undefined : references;
}

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${SEPARATOR}`));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/**
 * Remove generated peer-extension directories outside the declared module graph.
 * Keep whole reachable directories, including their runtime assets. Uncertain
 * graphs preserve existing output. Complete graphs also report package-root
 * entries that later cleanup must retain, including module-relative assets.
 */
export async function pruneUnreachableExtensionDirectories(input: {
  outDir: string;
  entryPointPaths: readonly string[];
}): Promise<
  | { kind: "complete"; referencedTopLevelEntries: ReadonlySet<string> }
  | { kind: "uncertain" }
> {
  const esmRoot = resolve(input.outDir, "esm");
  const extensionRoot = resolve(esmRoot, "extensions");
  const pending: string[] = [];
  for (const entryPoint of input.entryPointPaths) {
    const path = resolve(input.outDir, entryPoint);
    if (!within(esmRoot, path) || !await isFile(path)) {
      return { kind: "uncertain" };
    }
    pending.push(path);
  }
  if (pending.length === 0) return { kind: "uncertain" };

  const visited = new Set<string>();
  const referencedTopLevelEntries = new Set<string>();
  const reachableDirectories = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || visited.has(path)) continue;
    visited.add(path);
    const topLevelEntry = relative(esmRoot, path).split(SEPARATOR)[0];
    if (topLevelEntry) referencedTopLevelEntries.add(topLevelEntry);
    if (within(extensionRoot, path)) {
      const directory = relative(extensionRoot, path).split(SEPARATOR)[0];
      if (directory) reachableDirectories.add(directory);
    }
    if (!/\.(?:[cm]?js|d\.[cm]?ts)$/.test(path)) continue;
    const references = await localReferences(
      await Deno.readTextFile(path),
      path,
    );
    if (references === undefined) return { kind: "uncertain" };
    for (const specifier of references) {
      let target = resolve(dirname(path), specifier.replace(/[?#].*$/, ""));
      if (!within(esmRoot, target)) return { kind: "uncertain" };
      if (path.endsWith(".d.ts") && target.endsWith(".js")) {
        const declaration = target.slice(0, -3) + ".d.ts";
        if (await isFile(declaration)) target = declaration;
      }
      if (!await isFile(target)) return { kind: "uncertain" };
      pending.push(target);
    }
  }
  try {
    for await (const entry of Deno.readDir(extensionRoot)) {
      if (entry.isDirectory && !reachableDirectories.has(entry.name)) {
        await Deno.remove(resolve(extensionRoot, entry.name), {
          recursive: true,
        });
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return { kind: "complete", referencedTopLevelEntries };
}
