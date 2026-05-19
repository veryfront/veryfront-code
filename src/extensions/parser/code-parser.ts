/**
 * Contract interface for code parsing and AST manipulation.
 *
 * Default implementation: `@veryfront/ext-parser-babel`
 *
 * @module extensions/parser/code-parser
 */

/** A single node in an abstract syntax tree. */
export interface ASTNode {
  /** Node type identifier (e.g. `"Identifier"`, `"CallExpression"`). */
  type: string;
  /** Start character offset in the source. */
  start?: number;
  /** End character offset in the source. */
  end?: number;
  /** Child nodes and properties. */
  [key: string]: unknown;
}

/** Wrapper providing traversal context for a visited node. */
export interface NodePath<T extends ASTNode = ASTNode> {
  /** The AST node at this path. */
  node: T;
  /** The parent path, if any. */
  parent: NodePath | undefined;
  /** Replace this node with one or more new nodes. */
  replaceWith(node: ASTNode): void;
  /** Remove this node from the tree. */
  remove(): void;
}

/** Visitor callbacks keyed by node type. */
export interface TraverseVisitor {
  [nodeType: string]:
    | ((path: NodePath) => void)
    | {
      enter?(path: NodePath): void;
      exit?(path: NodePath): void;
    };
}

/** Options passed to {@link CodeParser.parse}. */
export interface ParseOptions {
  /** Source code to parse. */
  code: string;
  /** File path hint for parser configuration (e.g. `.TSX`). */
  filePath?: string;
  /** Additional parser-specific options. */
  [key: string]: unknown;
}

/** Options passed to {@link CodeParser.generate}. */
export interface GenerateOptions {
  /** Include source maps in the output. */
  sourceMaps?: boolean;
  /** Minify the generated code. */
  minified?: boolean;
  /** Additional generator-specific options. */
  [key: string]: unknown;
}

/** Result returned from {@link CodeParser.generate}. */
export interface GenerateResult {
  /** Generated source code. */
  code: string;
  /** Source map, if requested. */
  map?: string;
}

/**
 * CodeParser contract interface.
 *
 * Implementations parse source code into ASTs, traverse/transform
 * nodes, and generate code back from modified trees.
 */
/** Options for {@link CodeParser.injectJsxNodePositions}. */
export interface InjectJsxNodePositionsOptions {
  /** Source file path — emitted into `data-node-file` attributes. */
  filePath: string;
}

/** Public API contract for code parser. */
export interface CodeParser {
  /** Parse source code into an abstract syntax tree. */
  parse(options: ParseOptions): Promise<ASTNode>;
  /** Walk the AST calling visitor callbacks for matching node types. */
  traverse(ast: ASTNode, visitor: TraverseVisitor): void;
  /** Generate source code from an AST. */
  generate(ast: ASTNode, options?: GenerateOptions): Promise<GenerateResult>;
  /**
   * Inject `data-node-*` attributes into every JSX element in the source,
   * enabling Studio Navigator to map rendered elements back to their
   * source positions. Parsing failures return the input unchanged.
   */
  injectJsxNodePositions(source: string, options: InjectJsxNodePositionsOptions): string;
}
