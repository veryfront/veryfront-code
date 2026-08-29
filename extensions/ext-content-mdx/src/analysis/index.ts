import { analyzeMarkdown } from "./markdown.ts";
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
  const document = analyzeMarkdown(options.value, options.frontmatter === true);
  return Promise.resolve({ kind: "document", ...document });
}
