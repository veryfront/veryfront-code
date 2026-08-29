export type ContentSyntax = "markdown" | "mdx";

export interface SourcePoint {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceRange {
  readonly start: SourcePoint;
  readonly end: SourcePoint;
}

interface DestinationBase {
  readonly rawValue: string;
  readonly range: SourceRange;
}

export type ContentDestination =
  | (DestinationBase & {
    readonly kind:
      | "markdown-link"
      | "markdown-image"
      | "markdown-definition";
    readonly syntax: "markdown";
  })
  | (DestinationBase & {
    readonly kind: "autolink";
    readonly syntax: "autolink";
  })
  | (DestinationBase & {
    readonly kind: "html-attribute";
    readonly syntax: "html-attribute";
  })
  | (DestinationBase & {
    readonly kind: "mdx-jsx-attribute";
    readonly syntax: "html-attribute" | "javascript-string";
  });

export interface ContentSyntaxDiagnostic {
  readonly message: string;
  readonly range: SourceRange;
}

export interface AnalyzeContentOptions {
  readonly value: string;
  readonly syntax: ContentSyntax;
  readonly frontmatter?: boolean;
  readonly filePath?: string;
}

export type ContentAnalysisResult =
  | {
    readonly kind: "document";
    readonly renderedRanges: readonly SourceRange[];
    readonly destinations: readonly ContentDestination[];
  }
  | {
    readonly kind: "syntax-error";
    readonly diagnostic: ContentSyntaxDiagnostic;
  };
