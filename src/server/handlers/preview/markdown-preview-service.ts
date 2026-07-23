import { extract } from "#std/front-matter/yaml.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { PathValidationError, validatePath } from "#veryfront/security";
import { compileMarkdownRuntime } from "#veryfront/transforms/md/compiler/md-compiler.ts";
import { serverLogger } from "#veryfront/utils";
import type { HandlerContext } from "../types.ts";
import { runWithProjectSourceContext } from "../shared/project-source-context.ts";
import { generateMarkdownHtml } from "./markdown-html-generator.ts";

const logger = serverLogger.component("markdown-preview-handler");
const MAX_MARKDOWN_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_MARKDOWN_HTML_BYTES = 16 * 1024 * 1024;
const textEncoder = new TextEncoder();

export type MarkdownPreviewRenderResult =
  | { kind: "html"; html: string }
  | { kind: "missing" }
  | { kind: "continue" };

function assertBoundedText(value: string, maximum: number, label: string): void {
  if (value.length > maximum || textEncoder.encode(value).byteLength > maximum) {
    throw new RangeError(`${label} exceeds the size limit`);
  }
}

export class MarkdownPreviewService {
  render(
    req: Request,
    ctx: HandlerContext,
    filePath: string,
    url: URL,
    nonce?: string,
  ): Promise<MarkdownPreviewRenderResult> {
    return runWithProjectSourceContext(
      ctx,
      () => this.renderFromActiveSource(req, ctx, filePath, url, nonce),
      { productionMode: false },
    );
  }

  private async renderFromActiveSource(
    req: Request,
    ctx: HandlerContext,
    filePath: string,
    url: URL,
    nonce?: string,
  ): Promise<MarkdownPreviewRenderResult> {
    const validation = await validatePath(filePath, {
      baseDir: ctx.projectDir,
      level: "strict",
      followSymlinks: false,
      checkExists: true,
      allowAbsolute: false,
      adapter: ctx.adapter,
    });
    if (!validation.valid || !validation.canonicalPath) {
      if (validation.code !== PathValidationError.FILE_NOT_FOUND) {
        logger.warn("Markdown preview canonical path rejected", {
          reason: validation.code ?? "invalid",
        });
      }
      return { kind: "missing" };
    }

    const canonicalPath = validation.canonicalPath;
    let content: string;
    try {
      const info = await ctx.adapter.fs.stat(canonicalPath);
      if (!info.isFile) return { kind: "missing" };
      if (
        !Number.isSafeInteger(info.size) || info.size < 0 ||
        info.size > MAX_MARKDOWN_SOURCE_BYTES
      ) {
        throw new RangeError("Markdown preview source exceeds the size limit");
      }
      content = await ctx.adapter.fs.readFile(canonicalPath);
    } catch (error) {
      if (isNotFoundError(error)) return { kind: "missing" };
      throw error;
    }
    assertBoundedText(content, MAX_MARKDOWN_SOURCE_BYTES, "Markdown preview source");

    const extracted = extract(content);
    const frontmatter = extracted.attrs as Record<string, unknown>;
    if (frontmatter.prose === false) return { kind: "continue" };

    const bundle = await compileMarkdownRuntime(
      "development",
      ctx.projectDir,
      extracted.body,
      frontmatter,
      filePath,
      "server",
    );
    const rawHtml = bundle.rawHtml || "";
    assertBoundedText(rawHtml, MAX_MARKDOWN_HTML_BYTES, "Markdown preview output");

    const html = generateMarkdownHtml({
      rawHtml,
      title: frontmatter.title != null ? String(frontmatter.title) : filePath,
      description: frontmatter.description != null ? String(frontmatter.description) : "",
      request: req,
      url,
      projectId: ctx.projectSlug || ctx.projectId || "markdown-preview",
      filePath,
      nonce,
    });
    assertBoundedText(html, MAX_MARKDOWN_HTML_BYTES, "Markdown preview document");
    logger.debug("Serving markdown preview", { htmlLength: html.length });
    return { kind: "html", html };
  }
}
