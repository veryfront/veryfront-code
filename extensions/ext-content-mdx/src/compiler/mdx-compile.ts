import { compile } from "@mdx-js/mdx";
import type { Pluggable } from "unified";
import type { ContentCompileOptions, ContentProcessingResult } from "veryfront/extensions/content";
import { getRehypePlugins, getRemarkPlugins } from "../plugins/plugin-loader.ts";
import { extractContentFrontmatter } from "./frontmatter-extractor.ts";
import { rehypeNodePositions } from "../plugins/rehype-node-positions.ts";
import { createModuleImportRewriter } from "./module-imports.ts";
import { prepareModuleValues, validateModuleProgram } from "./module-values.ts";

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
    moduleValues,
    remarkPlugins: additionalRemarkPlugins = [],
    rehypePlugins: additionalRehypePlugins = [],
  } = options;

  const remarkPlugins = [
    ...getRemarkPlugins(),
    ...additionalRemarkPlugins,
  ] as unknown as PluggableList;
  const rehypePlugins = [
    ...getRehypePlugins(),
    ...additionalRehypePlugins,
  ] as unknown as PluggableList;

  if (studioEmbed && filePath) {
    rehypePlugins.push([rehypeNodePositions, { filePath }] as unknown as Pluggable);
  }
  if (moduleValues !== undefined && outputFormat !== "program") {
    throw new TypeError("MDX module values require program output");
  }

  const { body: extractedBody, frontmatter: extractedFrontmatter } = extractContentFrontmatter({
    content,
    frontmatter: providedFrontmatter,
    syntax: "mdx",
  });

  const preparedModuleValues = moduleValues === undefined
    ? undefined
    : prepareModuleValues(moduleValues);
  const moduleImportRewriter = createModuleImportRewriter({
    filePath,
    target,
    baseUrl,
    projectDir,
  });
  const recmaPlugins: PluggableList = [moduleImportRewriter];
  if (preparedModuleValues) recmaPlugins.push(preparedModuleValues.plugin);

  const compiled = await compile(extractedBody, {
    outputFormat,
    // Build mode is not a React-runtime selector. Veryfront intentionally emits
    // the portable JSX runtime in both modes until the server, browser import
    // map, and renderer can select one shared development React instance.
    // Mixing jsx-dev-runtime with the current production-compatible renderer
    // crashes during element creation (`dispatcher.getOwner` is unavailable).
    development: false,
    remarkPlugins,
    rehypePlugins,
    providerImportSource,
    jsxImportSource: "react",
    recmaPlugins,
  });

  const headings = (compiled.data?.headings as
    | Array<{ id: string; text: string; level: number }>
    | undefined) ??
    [];

  const compiledCode = String(compiled);

  if (outputFormat === "program") {
    validateModuleProgram(compiledCode);
  }

  return {
    compiledCode,
    frontmatter: extractedFrontmatter,
    globals: preparedModuleValues?.bindings ?? {},
    headings,
    nodeMap: new Map(),
  };
}
