import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import type { Root as MdastRoot } from "mdast";
import type { Heading } from "mdast";
import { rendererLogger as logger } from "#veryfront/utils";
import { extractFrontmatter } from "../../mdx/compiler/frontmatter-extractor.ts";
import type {
  CompilationMode,
  CompilationTarget,
  MdxRuntimeBundle,
} from "../../mdx/compiler/types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
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
          .use(rehypeHighlight, { detect: true, ignoreMissing: true })
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

        // Check frontmatter for prose: false to disable typography styles
        const useProse = extractedFrontmatter.prose !== false;
        const baseClasses = useProse ? "prose dark:prose-invert mx-auto p-4" : "mx-auto p-4";

        const compiledCode = `import { jsx as _jsx } from "react/jsx-runtime";
export default function MDContent({ components, className, ...props }) {
  return _jsx("div", {
    ...props,
    className: className ? \`${baseClasses} \${className}\` : "${baseClasses}",
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
