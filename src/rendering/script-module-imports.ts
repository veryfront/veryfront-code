import type { ASTNode, CodeParser } from "#veryfront/extensions/parser/code-parser.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { loadDefaultCodeParser } from "#veryfront/extensions/parser/defaults.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { pathToFileURL } from "node:url";
import type { LocalReactPeerSnapshot } from "#veryfront/platform/compat/react-paths.ts";

/** Bind computed CommonJS calls to their source issuer without hiding static imports from bundling. */
export async function bindDynamicScriptRequires(
  code: string,
  path: string,
  peers: LocalReactPeerSnapshot,
): Promise<string> {
  if (!code.includes("require")) return code;
  let parser = tryResolve<CodeParser>("CodeParser");
  if (!parser?.findStaticCommonJsImports) parser = await loadDefaultCodeParser();
  if (!parser?.findStaticCommonJsImports) {
    throw new TypeError("Script parser cannot verify CommonJS bindings");
  }
  const ast = await parser.parse({ code, filePath: path, allowReturnOutsideFunction: true });
  const candidates: Array<
    { marker: string; start: number; end: number; argStart: number; argEnd: number }
  > = [];
  const visit = ({ node }: { node: ASTNode }) => {
    const callee = node.callee as ASTNode | undefined;
    const args = node.arguments as ASTNode[] | undefined;
    const argument = args?.[0];
    const object = callee?.object as ASTNode | undefined;
    const property = callee?.property as ASTNode | undefined;
    const direct = callee?.type === "Identifier" && callee.name === "require";
    const member = callee?.type === "MemberExpression" && object?.type === "Identifier" &&
      object.name === "module" && property?.type === "Identifier" && property.name === "require" &&
      callee.computed !== true;
    if (
      (!direct && !member) || !argument || argument.type === "StringLiteral" ||
      (argument.type === "TemplateLiteral" && Array.isArray(argument.expressions) &&
        argument.expressions.length === 0)
    ) return;
    if (
      typeof callee?.start !== "number" || typeof callee.end !== "number" ||
      typeof argument.start !== "number" || typeof argument.end !== "number"
    ) {
      throw new TypeError("Script parser omitted CommonJS source positions");
    }
    let marker = `__vfScriptRequireProbe${candidates.length}`;
    while (code.includes(marker)) marker += "_";
    candidates.push({
      marker,
      start: callee.start,
      end: callee.end,
      argStart: argument.start,
      argEnd: argument.end,
    });
  };
  parser.traverse(ast, { CallExpression: visit, OptionalCallExpression: visit });
  if (candidates.length === 0) return code;
  // Probe calls separately so nested argument ranges cannot overlap source edits.
  // The existing parser capability supplies lexical binding analysis for shadowed require/module calls.
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const probe = code.slice(0, candidate.argStart) + JSON.stringify(candidate.marker) +
      code.slice(candidate.argEnd);
    const imports = await parser.findStaticCommonJsImports({ code: probe, filePath: path });
    if (imports.includes(candidate.marker)) selected.push(candidate);
  }
  if (selected.length === 0) return code;
  let name = "__vfSourceRequire";
  while (code.includes(name)) name += "_";
  let create = `${name}Create`;
  while (code.includes(create)) create += "_";
  for (const candidate of selected.sort((a, b) => b.start - a.start)) {
    code = code.slice(0, candidate.start) + name + code.slice(candidate.end);
  }
  let fromURL = `${name}FromURL`;
  while (code.includes(fromURL)) fromURL += "_";
  const roots = Object.fromEntries(
    Object.entries(peers.roots).map((
      [key, root],
    ) => [key, pathToFileURL(join(root, "package.json")).href]),
  );
  return `import { createRequire as ${create} } from "node:module";\nimport { fileURLToPath as ${fromURL} } from "node:url";\n` +
    `const ${name} = (() => { const native = ${create}(${
      JSON.stringify(pathToFileURL(path).href)
    }); ` +
    `const paths = ${JSON.stringify(peers.paths)}; const roots = ${JSON.stringify(roots)}; ` +
    `return (specifier) => { if (typeof specifier !== "string") return native(specifier); const selected = paths[specifier]; ` +
    `if (typeof selected === "string") return native(${fromURL}(selected)); ` +
    `const peer = typeof specifier === "string" && (specifier === "react" || specifier.startsWith("react/")) ? "react" : ` +
    `typeof specifier === "string" && (specifier === "react-dom" || specifier.startsWith("react-dom/")) ? "react-dom" : undefined; ` +
    `return peer ? ${create}(roots[peer])(specifier) : native(specifier); }; })();\n${code}`;
}
