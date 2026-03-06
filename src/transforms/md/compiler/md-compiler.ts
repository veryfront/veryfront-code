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
import type { Heading, Root as MdastRoot } from "mdast";
import { rendererLogger } from "#veryfront/utils";
import { rehypeNodePositions } from "../../plugins/rehype-node-positions.ts";
import { extractFrontmatter } from "../../mdx/compiler/frontmatter-extractor.ts";
import type {
  CompilationMode,
  CompilationTarget,
  MdxRuntimeBundle,
} from "../../mdx/compiler/types.ts";
import { isMarkdownPreview as checkMarkdownPreview } from "../utils.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import Slugger from "github-slugger";

const logger = rendererLogger.component("md-compiler");

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
  if (isPreview) {
    return `import { jsx as _jsx } from "react/jsx-runtime";
export default function MDContent({ components, params, ...props }) {
  return _jsx("div", {
    className: "markdown-body",
    dangerouslySetInnerHTML: { __html: \`${escapedHtml}\` }
  });
}
`;
  }

  return `import { jsx as _jsx } from "react/jsx-runtime";
export default function MDContent({ components, params, className, ...props }) {
  return _jsx("div", {
    className,
    dangerouslySetInnerHTML: { __html: \`${escapedHtml}\` }
  });
}
`;
}

export function compileMarkdownRuntime(
  _mode: CompilationMode,
  _projectDir: string,
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
  _target: CompilationTarget = "server",
  _baseUrl?: string,
  studioEmbed?: boolean,
): Promise<MdxRuntimeBundle> {
  return withSpan(
    "transforms.compileMarkdownRuntime",
    async (): Promise<MdxRuntimeBundle> => {
      try {
        const { body, frontmatter: extractedFrontmatter } = extractFrontmatter(
          content,
          frontmatter,
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

        if (studioEmbed && filePath) {
          pipeline.use(rehypeNodePositions, { filePath });
        }

        const result = await pipeline
          .use(rehypeStringify, { allowDangerousHtml: true })
          .process(body);
        const html = String(result);

        logger.debug("Compiled markdown:", {
          filePath,
          htmlLength: html.length,
          headingsCount: headings.length,
        });

        const escapedHtml = escapeForJsString(html);

        // Use GitHub-style wrapper for standalone markdown files (not in pages/ or app/)
        // unless prose: false in frontmatter
        const isPreview = checkMarkdownPreview(filePath, extractedFrontmatter);

        // Note: destructure params/components to prevent them from spreading to DOM
        const compiledCode = createCompiledCode(escapedHtml, isPreview);

        return {
          compiledCode,
          frontmatter: extractedFrontmatter,
          globals: {},
          headings,
          nodeMap: new Map(),
          rawHtml: html,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        logger.error("Compilation failed:", {
          filePath,
          error: err.message,
          stack: err.stack,
        });

        throw toError(
          createError({
            type: "build",
            message: `Markdown compilation error: ${err.message} | file: ${filePath ?? "<memory>"}`,
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
