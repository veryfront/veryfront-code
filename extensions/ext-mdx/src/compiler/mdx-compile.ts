import { compile } from "@mdx-js/mdx";
import type { Pluggable } from "unified";
import type { ContentCompileOptions, ContentRuntimeBundle } from "veryfront/extensions/interfaces";
import { extractFrontmatter } from "veryfront/transforms/frontmatter";
import { rewriteBodyImports, rewriteCompiledImports } from "veryfront/transforms/import-rewriter";
import { getRehypePlugins, getRemarkPlugins } from "../plugins/plugin-loader.ts";
import { rehypeNodePositions } from "../plugins/rehype-node-positions.ts";

type PluggableList = Pluggable[];

export async function compileMdx(options: ContentCompileOptions): Promise<ContentRuntimeBundle> {
  const {
    projectDir,
    content,
    frontmatter: providedFrontmatter,
    filePath,
    target = "server",
    baseUrl,
    studioEmbed,
  } = options;

  const remarkPlugins = getRemarkPlugins() as unknown as PluggableList;
  const rehypePlugins = getRehypePlugins() as unknown as PluggableList;

  if (studioEmbed && filePath) {
    rehypePlugins.push([rehypeNodePositions, { filePath }] as unknown as Pluggable);
  }

  const { body: extractedBody, frontmatter: extractedFrontmatter } = extractFrontmatter(
    content,
    providedFrontmatter,
  );

  const shouldRewriteImports = Boolean(filePath) &&
    (target === "browser" || target === "server");
  const body = shouldRewriteImports
    ? rewriteBodyImports(extractedBody, { filePath: filePath!, target, baseUrl, projectDir })
    : extractedBody;

  const compiled = await compile(body, {
    outputFormat: "program",
    // Always false: @mdx-js/mdx development mode emits extra JSX
    // transforms that break the existing rendering pipeline.
    development: false,
    remarkPlugins,
    rehypePlugins,
    providerImportSource: undefined,
    jsxImportSource: "react",
  });

  const headings = (compiled.data?.headings as
    | Array<{ id: string; text: string; level: number }>
    | undefined) ??
    [];

  const compiledString = String(compiled);
  const compiledCode = shouldRewriteImports
    ? rewriteCompiledImports(compiledString, {
      filePath: filePath!,
      target,
      baseUrl,
      projectDir,
    })
    : compiledString;

  return {
    compiledCode,
    frontmatter: extractedFrontmatter,
    globals: {},
    headings,
    nodeMap: new Map(),
  };
}
