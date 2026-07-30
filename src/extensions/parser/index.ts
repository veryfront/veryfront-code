/**
 * Parser category barrel — CodeParser (AST traversal) contract.
 *
 * @module extensions/parser
 */

export type {
  ASTNode,
  CodeParser,
  FunctionDirectiveOptions,
  GenerateOptions,
  GenerateResult,
  InjectJsxNodePositionsOptions,
  NodePath,
  ParseOptions,
  TraverseVisitor,
} from "./code-parser.ts";

export { HTMLHeadLocatorName, MAX_HTML_HEAD_PARSE_BYTES } from "./html-head-locator.ts";
export type {
  AuthoredImportMapState,
  HtmlHeadInsertionPoint,
  HtmlHeadLocationResult,
  HTMLHeadLocator,
  HtmlHeadPlacement,
  HtmlModuleResolutionOrdering,
  MaxHTMLHeadParseBytes,
} from "./html-head-locator.ts";

export {
  createSkillDocumentParserProvider,
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
  snapshotSkillDocumentParserProvider,
} from "./skill-document-parser.ts";
