import type { ASTNode, CodeParser } from "#veryfront/extensions/parser/code-parser.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { loadDefaultCodeParser } from "#veryfront/extensions/parser/defaults.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { pathToFileURL } from "node:url";
import type { LocalReactPeerSnapshot } from "#veryfront/platform/compat/react-paths.ts";

/** Bind retained runtime imports to their source issuer while leaving static imports visible. */
export async function bindScriptModuleImports(
  code: string,
  path: string,
  peers: LocalReactPeerSnapshot,
  runtimeUrl: string,
  onGlob?: () => void,
): Promise<string> {
  if (!code.includes("require") && !code.includes("import")) return code;
  let parser = tryResolve<CodeParser>("CodeParser");
  if (!parser?.findStaticCommonJsImports) parser = await loadDefaultCodeParser();
  if (!parser?.findStaticCommonJsImports) {
    throw new TypeError("Script parser cannot verify CommonJS bindings");
  }
  const ast = await parser.parse({ code, filePath: path, allowReturnOutsideFunction: true });
  const dynamicCalls: Array<{ start: number; end: number }> = [];
  const dynamicImport = ({ node }: { node: ASTNode }) => {
    const callee = node.callee as ASTNode | undefined;
    if (node.type !== "ImportExpression" && callee?.type !== "Import") return;
    const argument = (node.source ?? (node.arguments as ASTNode[] | undefined)?.[0]) as
      | ASTNode
      | undefined;
    if (
      !argument || argument.type === "StringLiteral" ||
      (argument.type === "TemplateLiteral" && Array.isArray(argument.expressions) &&
        argument.expressions.length === 0)
    ) return;
    // esbuild expands relative template/concatenation patterns into compiled glob entries.
    // Keep those expressions visible; only bind imports whose targets stay native.
    let prefix = argument;
    while (prefix.type === "BinaryExpression" && prefix.operator === "+") {
      prefix = prefix.left as ASTNode;
    }
    const templatePrefix =
      (argument.quasis as Array<{ value?: { cooked?: string; raw?: string } }> | undefined)?.[0]
        ?.value;
    const literalPrefix = argument.type === "TemplateLiteral"
      ? templatePrefix?.cooked ?? templatePrefix?.raw
      : prefix.type === "StringLiteral"
      ? prefix.value
      : undefined;
    if (typeof literalPrefix === "string" && /^\.\.?\//.test(literalPrefix)) {
      onGlob?.();
      return;
    }
    if (typeof argument.start !== "number" || typeof argument.end !== "number") {
      throw new TypeError("Script parser omitted dynamic import source positions");
    }
    const start = callee?.start ?? node.start;
    const end = callee?.end ?? (typeof start === "number" ? start + "import".length : undefined);
    if (typeof start !== "number" || typeof end !== "number") {
      throw new TypeError("Script parser omitted dynamic import call positions");
    }
    dynamicCalls.push({ start, end });
  };
  const candidates: Array<
    {
      marker: string;
      start: number;
      end: number;
      argStart: number;
      argEnd: number;
      resolve: boolean;
    }
  > = [];
  const visit = ({ node }: { node: ASTNode }) => {
    const callee = node.callee as ASTNode | undefined;
    const args = node.arguments as ASTNode[] | undefined;
    const argument = args?.[0];
    const object = callee?.object as ASTNode | undefined;
    const property = callee?.property as ASTNode | undefined;
    const resolve = callee?.type === "MemberExpression" && object?.type === "Identifier" &&
      object.name === "require" && property?.type === "Identifier" && property.name === "resolve" &&
      callee.computed !== true;
    const direct = callee?.type === "Identifier" && callee.name === "require";
    const member = callee?.type === "MemberExpression" && object?.type === "Identifier" &&
      object.name === "module" && property?.type === "Identifier" && property.name === "require" &&
      callee.computed !== true;
    if (
      (!direct && !member && !resolve) || !argument ||
      (!resolve && (argument.type === "StringLiteral" ||
        (argument.type === "TemplateLiteral" && Array.isArray(argument.expressions) &&
          argument.expressions.length === 0)))
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
      resolve,
      start: callee.start,
      end: callee.end,
      argStart: argument.start,
      argEnd: argument.end,
    });
  };
  parser.traverse(ast, {
    CallExpression: (input) => {
      visit(input);
      dynamicImport(input);
    },
    OptionalCallExpression: visit,
    ImportExpression: dynamicImport,
  });
  // Probe calls separately so nested argument ranges cannot overlap source edits.
  // The existing parser capability supplies lexical binding analysis for shadowed require/module calls.
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const probe = code.slice(0, candidate.start) +
      (candidate.resolve ? "require" : code.slice(candidate.start, candidate.end)) +
      code.slice(candidate.end, candidate.argStart) + JSON.stringify(candidate.marker) +
      code.slice(candidate.argEnd);
    const imports = await parser.findStaticCommonJsImports({ code: probe, filePath: path });
    if (imports.includes(candidate.marker)) selected.push(candidate);
  }
  if (selected.length === 0 && dynamicCalls.length === 0) return code;
  let name = "__vfSourceRequire";
  while (code.includes(name)) name += "_";
  let create = `${name}Create`;
  while (code.includes(create)) create += "_";
  const edits = selected.map((candidate) => ({
    start: candidate.start,
    end: candidate.end,
    text: name + (candidate.resolve ? ".resolve" : ""),
  }));
  let importName = "__vfSourceImport";
  while (code.includes(importName)) importName += "_";
  for (const call of dynamicCalls) {
    edits.push({ start: call.start, end: call.end, text: importName });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  }
  if (dynamicCalls.length > 0) {
    let nativeImport = `${importName}Native`;
    while (code.includes(nativeImport)) nativeImport += "_";
    code =
      `import { importSourceModule as ${nativeImport} } from ${JSON.stringify(runtimeUrl)};\n` +
      `const ${importName} = (specifier, options) => ${nativeImport}(specifier, options, ${
        JSON.stringify(pathToFileURL(path).href)
      }, ${JSON.stringify(peers)});\n${code}`;
  }
  if (selected.length === 0) return code;
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
    `const bound = (specifier) => { if (typeof specifier !== "string") return native(specifier); const selected = paths[specifier]; ` +
    `if (typeof selected === "string") return native(${fromURL}(selected)); ` +
    `const peer = typeof specifier === "string" && (specifier === "react" || specifier.startsWith("react/")) ? "react" : ` +
    `typeof specifier === "string" && (specifier === "react-dom" || specifier.startsWith("react-dom/")) ? "react-dom" : undefined; ` +
    `return peer ? ${create}(roots[peer])(specifier) : native(specifier); }; bound.resolve = (specifier, options) => { const selected = paths[specifier]; if (typeof selected === "string") return ${fromURL}(selected); const peer = typeof specifier === "string" && (specifier === "react" || specifier.startsWith("react/")) ? "react" : typeof specifier === "string" && (specifier === "react-dom" || specifier.startsWith("react-dom/")) ? "react-dom" : undefined; return (peer ? ${create}(roots[peer]) : native).resolve(specifier, options); }; return bound; })();\n${code}`;
}
