import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeStarryNight from "rehype-starry-night";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import Slugger from "github-slugger";
import type { Heading, Root as MdastRoot } from "mdast";
import type { ContentCompileOptions, MdxRuntimeBundle } from "veryfront/extensions/interfaces";
import { extractFrontmatter } from "veryfront/transforms/frontmatter";
import { isMarkdownPreview } from "veryfront/transforms/md-utils";
import { rehypeNodePositions } from "../plugins/rehype-node-positions.ts";

interface ExtractedHeading {
  id: string;
  text: string;
  level: number;
}

function remarkExtractHeadings(headings: ExtractedHeading[]) {
  const slugger = new Slugger();

  return (tree: MdastRoot): void => {
    visit(tree, "heading", (node: Heading) => {
      const text = toString(node);
      const id = slugger.slug(text);
      headings.push({ id, text, level: node.depth });
    });
  };
}

function escapeForJsString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

function createCompiledCode(escapedHtml: string, isPreview: boolean): string {
  const injector = `dangerouslySetInnerHTML: { __html: \`${escapedHtml}\` }`;
  if (isPreview) {
    return `import { jsx as _jsx } from "react/jsx-runtime";
export default function MDContent({ components, params, ...props }) {
  return _jsx("div", {
    className: "markdown-body",
    ${injector}
  });
}
`;
  }

  return `import { jsx as _jsx } from "react/jsx-runtime";
export default function MDContent({ components, params, className, ...props }) {
  return _jsx("div", {
    className,
    ${injector}
  });
}
`;
}

export async function compileMarkdown(
  options: ContentCompileOptions,
): Promise<MdxRuntimeBundle> {
  const { content, frontmatter: providedFrontmatter, filePath, studioEmbed } = options;

  const { body, frontmatter: extractedFrontmatter } = extractFrontmatter(
    content,
    providedFrontmatter,
  );

  const headings: ExtractedHeading[] = [];

  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter)
    .use(remarkExtractHeadings, headings)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStarryNight)
    .use(rehypeSlug);

  pipeline.use(rehypeRaw);

  if (studioEmbed && filePath) {
    pipeline.use(rehypeNodePositions, { filePath });
  }

  const sanitizeSchema = studioEmbed
    ? {
      ...defaultSchema,
      attributes: {
        ...defaultSchema.attributes,
        "*": [
          ...(defaultSchema.attributes?.["*"] ?? []),
          "data-node-file",
          "data-node-name",
          "data-node-line",
          "data-node-column",
          "data-node-source",
        ],
      },
    }
    : defaultSchema;

  const result = await pipeline
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
    .process(body);
  const html = String(result);

  const escapedHtml = escapeForJsString(html);
  const isPreview = isMarkdownPreview(filePath, extractedFrontmatter);
  const compiledCode = createCompiledCode(escapedHtml, isPreview);

  return {
    compiledCode,
    frontmatter: extractedFrontmatter,
    globals: {},
    headings,
    nodeMap: new Map(),
    rawHtml: html,
  };
}
