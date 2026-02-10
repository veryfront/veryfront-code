export type RuleId =
  | "no-default-export"
  | "no-explicit-public"
  | "identifier-casing";

export interface Finding {
  rule: RuleId;
  file: string;
  line: number;
  column: number;
  message: string;
}

export interface ParseFailure {
  file: string;
  message: string;
}

export interface AstNodeLike {
  type?: string;
  loc?: {
    start?: {
      line?: number;
      column?: number;
    };
  };
  accessibility?: string;
  [key: string]: unknown;
}

export interface SourceLocation {
  line: number;
  column: number;
}

export interface RuleContext {
  file: string;
  report: (
    node: AstNodeLike,
    message: string,
    location?: SourceLocation,
  ) => void;
}

export interface StyleRule {
  id: RuleId;
  visit: (node: AstNodeLike, context: RuleContext) => void;
}
