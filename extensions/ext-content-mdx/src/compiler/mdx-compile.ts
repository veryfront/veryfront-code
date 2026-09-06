import { compile } from "@mdx-js/mdx";
import type { Pluggable } from "unified";
import type { ContentCompileOptions, ContentProcessingResult } from "veryfront/extensions/content";
import { extractFrontmatter } from "veryfront/transforms/frontmatter";
import { rewriteBodyImports, rewriteCompiledImports } from "veryfront/transforms/import-rewriter";
import { getRehypePlugins, getRemarkPlugins } from "../plugins/plugin-loader.ts";
import { rehypeNodePositions } from "../plugins/rehype-node-positions.ts";
import { recmaLayoutExport } from "../plugins/recma-layout-export.ts";

type PluggableList = Pluggable[];

export async function compileMdx(options: ContentCompileOptions): Promise<ContentProcessingResult> {
  const {
    projectDir,
    content,
    frontmatter: providedFrontmatter,
    filePath,
    target = "server",
    baseUrl,
    studioEmbed,
    outputFormat = "program",
    providerImportSource,
    remarkPlugins: additionalRemarkPlugins = [],
    rehypePlugins: additionalRehypePlugins = [],
  } = options;

  const remarkPlugins = [
    ...getRemarkPlugins(),
    ...additionalRemarkPlugins,
  ] as PluggableList;
  const rehypePlugins = [
    ...getRehypePlugins(),
    ...additionalRehypePlugins,
  ] as PluggableList;

  if (studioEmbed && filePath) {
    rehypePlugins.push([rehypeNodePositions, { filePath }] as Pluggable);
  }

  const { body: extractedBody, frontmatter: extractedFrontmatter } = extractFrontmatter(
    content,
    providedFrontmatter,
  );

  const shouldRewriteImports = !options.preserveImports && Boolean(filePath) &&
    (target === "browser" || target === "server");
  const body = shouldRewriteImports
    ? rewriteBodyImports(extractedBody, { filePath: filePath!, target, baseUrl, projectDir })
    : extractedBody;

  const compiled = await compile(body, {
    outputFormat,
    // Always false: @mdx-js/mdx development mode emits extra JSX
    // transforms that break the existing rendering pipeline.
    development: false,
    remarkPlugins,
    rehypePlugins,
    recmaPlugins: outputFormat === "program" ? [recmaLayoutExport] : [],
    providerImportSource,
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
