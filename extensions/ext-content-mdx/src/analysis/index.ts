import { analyzeMarkdown } from "./markdown.ts";
import { analyzeMdx } from "./mdx.ts";
import type {
  AnalyzeContentOptions,
  ContentAnalysisResult,
  ContentDestination,
  ContentSyntax,
  ContentSyntaxDiagnostic,
  SourcePoint,
  SourceRange,
} from "./types.ts";

export type {
  AnalyzeContentOptions,
  ContentAnalysisResult,
  ContentDestination,
  ContentSyntax,
  ContentSyntaxDiagnostic,
  SourcePoint,
  SourceRange,
};

export function analyzeContent(
  options: AnalyzeContentOptions,
): Promise<ContentAnalysisResult> {
  if (options.syntax === "mdx") {
    return analyzeMdx({
      value: options.value,
      frontmatter: options.frontmatter === true,
      filePath: options.filePath,
    });
  }
  return Promise.resolve(analyzeMarkdown(options.value, options.frontmatter === true));
}
