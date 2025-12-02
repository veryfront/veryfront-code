import { join } from "../../platform/compat/path-helper.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import type { HTMLGenerationOptions } from "@veryfront/html";
import {
  extractHTMLMetadata,
  generateHTMLShellParts,
  injectHTMLContent,
  isFullHTMLDocument,
  wrapInHTMLShell,
} from "@veryfront/html";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type {
  EntityInfo,
  LayoutItem,
  MdxBundle,
  MDXFrontmatter,
  PageBundle,
} from "@veryfront/types";
import { DEFAULT_DASHBOARD_PORT, rendererLogger as logger } from "@veryfront/utils";
import { detectAppRouter } from "../router-detection.ts";
import type { RenderOptions } from "./types.ts";

export interface HTMLGeneratorConfig {
  projectDir: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  mode: "development" | "production";
}

export interface HTMLGenerationContext {
  html: string;
  pageInfo: EntityInfo;
  pageBundle: PageBundle;
  layoutBundle: MdxBundle | undefined;
  nestedLayouts: LayoutItem[];
  providerInfos: EntityInfo[];
  collectedMetadata: Record<string, unknown>;
  slug: string;
  ssrHash: string;
  options?: RenderOptions;
}

export class HTMLGenerator {
  private config: HTMLGeneratorConfig;

  constructor(config: HTMLGeneratorConfig) {
    this.config = config;
  }

  async generateFullHTML(context: HTMLGenerationContext): Promise<string> {
    if (isFullHTMLDocument(context.html)) {
      return await this.handleFullHTMLDocument(context);
    }

    return await this.wrapHTMLFragment(context);
  }

  /**
   * Generate HTML stream for streaming SSR
   * Wraps the React stream with HTML shell parts
   */
  async generateHTMLStream(
    reactStream: ReadableStream,
    context: Omit<HTMLGenerationContext, "html">,
  ): Promise<ReadableStream> {
    const mergedFrontmatter = this.mergeFrontmatter(
      context as HTMLGenerationContext,
    );
    const useAppRouter = await detectAppRouter(
      this.config.projectDir,
      this.config.config,
      this.config.adapter,
    );
    const appComponentPath = await this.resolveAppComponentPath(useAppRouter);

    const htmlOptions: HTMLGenerationOptions = {
      mode: this.config.mode,
      config: this.config.config,
      nestedLayouts: context.nestedLayouts.map((l) => ({
        kind: l.kind,
        path: l.path,
        componentPath: l.componentPath,
      })),
      providerPaths: context.providerInfos.map((p) => p.entity.id),
      appPath: appComponentPath,
      pagePath: context.pageInfo.entity.id,
      nonce: context.options?.nonce,
    };

    const { start, end } = await generateHTMLShellParts(
      {
        title: mergedFrontmatter.title || "Veryfront App",
        description: mergedFrontmatter.description || "",
        slug: context.slug,
        frontmatter: mergedFrontmatter,
        layoutFrontmatter: context.layoutBundle?.frontmatter,
        ssrHash: context.ssrHash,
      },
      htmlOptions,
      context.options?.params,
      context.options?.props,
    );

    const encoder = new TextEncoder();
    const startChunk = encoder.encode(start);
    const endChunk = encoder.encode(end);

    return new ReadableStream({
      start(controller) {
        controller.enqueue(startChunk);
      },
      async pull(controller) {
        const reader = reactStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.enqueue(endChunk);
              controller.close();
              break;
            }
            controller.enqueue(value);
          }
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });
  }

  private async handleFullHTMLDocument(
    context: HTMLGenerationContext,
  ): Promise<string> {
    const metadata = extractHTMLMetadata(
      (context.pageInfo.entity.frontmatter || {}) as MDXFrontmatter,
      (context.layoutBundle?.frontmatter || {}) as MDXFrontmatter,
    );

    // Detect if the page has 'use client' directive for hydration
    let isClientPage = false;
    const pagePath = context.pageInfo.entity.id;
    try {
      const pageContent = await this.config.adapter.fs.readFile(pagePath);
      // Match 'use client' or "use client" at start of line
      isClientPage = /^\s*['"]use client['"];?\s*$/m.test(pageContent);
      if (isClientPage) {
        logger.info(`[HTMLGenerator] Detected 'use client' page: ${pagePath}`);
      }
    } catch (_e) {
      logger.debug(
        `[HTMLGenerator] Could not read page file for directive detection: ${pagePath}`,
      );
    }

    const injectedHtml = injectHTMLContent(context.html, "", metadata, {
      mode: this.config.mode,
      slug: context.slug,
      devPort: this.config.config?.dev?.port || DEFAULT_DASHBOARD_PORT,
      pagePath: isClientPage ? pagePath : undefined,
      isClientPage,
    });

    return injectedHtml.trimStart().toLowerCase().startsWith("<!doctype")
      ? injectedHtml
      : `<!DOCTYPE html>\n${injectedHtml}`;
  }

  private async wrapHTMLFragment(
    context: HTMLGenerationContext,
  ): Promise<string> {
    const mergedFrontmatter = this.mergeFrontmatter(context);
    logger.info("Merged frontmatter for wrapInHTMLShell:", mergedFrontmatter);

    const useAppRouter = await detectAppRouter(
      this.config.projectDir,
      this.config.config,
      this.config.adapter,
    );

    const appComponentPath = await this.resolveAppComponentPath(useAppRouter);

    const htmlOptions: HTMLGenerationOptions = {
      mode: this.config.mode,
      config: this.config.config,
      nestedLayouts: context.nestedLayouts.map((l) => ({
        kind: l.kind,
        path: l.path,
        componentPath: l.componentPath,
      })),
      providerPaths: context.providerInfos.map((p) => p.entity.id),
      appPath: appComponentPath,
      pagePath: context.pageInfo.entity.id,
      nonce: context.options?.nonce,
    };

    return await wrapInHTMLShell(
      context.html,
      {
        title: mergedFrontmatter.title || "Veryfront App",
        description: mergedFrontmatter.description || "",
        slug: context.slug,
        frontmatter: mergedFrontmatter,
        layoutFrontmatter: context.layoutBundle?.frontmatter,
        ssrHash: context.ssrHash,
      },
      htmlOptions,
      context.options?.params,
      context.options?.props,
    );
  }

  private mergeFrontmatter(context: HTMLGenerationContext): MDXFrontmatter {
    return {
      ...context.pageInfo.entity.frontmatter,
      ...(context.pageBundle as MdxBundle).frontmatter,
      ...(context.collectedMetadata || {}),
    } as MDXFrontmatter;
  }

  private async resolveAppComponentPath(
    useAppRouter: boolean,
  ): Promise<string | undefined> {
    if (useAppRouter) {
      return undefined;
    }

    const appPath = join(this.config.projectDir, "components/app.tsx");
    const appExists = await this.config.adapter.fs.exists(appPath);
    return appExists ? appPath : undefined;
  }
}
