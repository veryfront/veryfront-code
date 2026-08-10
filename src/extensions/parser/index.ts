/**
 * Parser category barrel: CodeParser (AST traversal), SkillDocumentParser
 * (Skill frontmatter decoding), and YamlParser (general YAML decoding)
 * contracts.
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

export {
  createSkillDocumentParserProvider,
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
  snapshotSkillDocumentParserProvider,
} from "./skill-document-parser.ts";

export {
  createYamlParserProvider,
  snapshotYamlParserProvider,
  type YamlParseOptions,
  type YamlParserProvider,
  YamlParserProviderName,
} from "./yaml-parser.ts";
