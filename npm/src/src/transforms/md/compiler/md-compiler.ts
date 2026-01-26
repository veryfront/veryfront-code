import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeStarryNight from "rehype-starry-night";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import type { Root as MdastRoot } from "@types/mdast";
import type { Heading } from "@types/mdast";
import { rendererLogger as logger } from "../../../utils/index.js";
import { extractFrontmatter } from "../../mdx/compiler/frontmatter-extractor.js";
import type {
  CompilationMode,
  CompilationTarget,
  MdxRuntimeBundle,
} from "../../mdx/compiler/types.js";
import { isMarkdownPreview as checkMarkdownPreview } from "../utils.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import Slugger from "github-slugger";

interface ExtractedHeading {
  id: string;
  text: string;
  level: number;
}

function remarkExtractHeadings(headings: ExtractedHeading[]) {
  const slugger = new Slugger();

  return (tree: MdastRoot) => {
    visit(tree, "heading", (node: Heading) => {
      const text = toString(node);
      const id = slugger.slug(text);
      headings.push({ id, text, level: node.depth });
    });
  };
}

function escapeForJsString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}

export function compileMarkdownRuntime(
  _mode: CompilationMode,
  _projectDir: string,
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
  _target: CompilationTarget = "server",
  _baseUrl?: string,
): Promise<MdxRuntimeBundle> {
  return withSpan(
    "transforms.compileMarkdownRuntime",
    async () => {
      try {
        const { body, frontmatter: extractedFrontmatter } = extractFrontmatter(
          content,
          frontmatter,
        );

        const headings: ExtractedHeading[] = [];

        const processor = unified()
          .use(remarkParse)
          .use(remarkGfm)
          .use(remarkFrontmatter)
          .use(remarkExtractHeadings, headings)
          .use(remarkRehype, { allowDangerousHtml: true })
          .use(rehypeStarryNight)
          .use(rehypeSlug)
          .use(rehypeStringify, { allowDangerousHtml: true });

        const result = await processor.process(body);
        const html = String(result);

        logger.debug("[MD Compiler] Compiled markdown:", {
          filePath,
          htmlLength: html.length,
          headingsCount: headings.length,
        });

        const escapedHtml = escapeForJsString(html);

        // Use GitHub-style wrapper for standalone markdown files (not in pages/ or app/)
        // unless prose: false in frontmatter
        const isPreview = checkMarkdownPreview(filePath, extractedFrontmatter);

        // Note: destructure params/components to prevent them from spreading to DOM
        const compiledCode = isPreview
          ? `import { jsx as _jsx } from "react/jsx-runtime";
export default function MDContent({ components, params, ...props }) {
  return _jsx("div", {
    className: "markdown-body",
    dangerouslySetInnerHTML: { __html: \`${escapedHtml}\` }
  });
}
`
          : `import { jsx as _jsx } from "react/jsx-runtime";
export default function MDContent({ components, params, className, ...props }) {
  return _jsx("div", {
    className,
    dangerouslySetInnerHTML: { __html: \`${escapedHtml}\` }
  });
}
`;

        return {
          compiledCode,
          frontmatter: extractedFrontmatter,
          globals: {},
          headings,
          nodeMap: new Map(),
          rawHtml: html,
        };
      } catch (error) {
        logger.error("[MD Compiler] Compilation failed:", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });

        throw toError(
          createError({
            type: "build",
            message: `Markdown compilation error: ${
              error instanceof Error ? error.message : String(error)
            } | file: ${filePath ?? "<memory>"}`,
          }),
        );
      }
    },
    {
      "md.filePath": filePath ?? "memory",
      "md.contentLength": content.length,
    },
  );
}
