/**
 * Static checks for runnable guide snippets.
 *
 * `check-guide-snippets.ts` combines these helpers with `deno check` and
 * `bash -n` so published integration examples stay copyable.
 */

export interface GuideFence {
  readonly lang: string;
  readonly code: string;
  /** 1-based line of the opening fence. */
  readonly line: number;
}

export interface SnippetIssue {
  readonly line: number;
  readonly message: string;
}

/** Collect fenced code blocks with their language tag and opening line. */
export function extractFences(markdown: string): GuideFence[] {
  const fences: GuideFence[] = [];
  const lines = markdown.split("\n");
  let open: { lang: string; line: number; body: string[] } | undefined;
  lines.forEach((text, index) => {
    const marker = /^```(\S*)/.exec(text);
    if (!open && marker) {
      open = { lang: marker[1] ?? "", line: index + 1, body: [] };
    } else if (open && /^```\s*$/.test(text)) {
      fences.push({
        lang: open.lang,
        code: open.body.join("\n"),
        line: open.line,
      });
      open = undefined;
    } else if (open) {
      open.body.push(text);
    }
  });
  return fences;
}

const PLACEHOLDER = /<[A-Z][A-Z0-9_]*>/g;
const HEREDOC_START = /<<-?\s*['"]?(\w+)['"]?/;

/** Blank quoted spans and drop a trailing comment, keeping character offsets. */
function unquotedText(line: string): string {
  let result = "";
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote) {
      const escaped = char === "\\" && quote === '"';
      if (escaped) i++;
      if (char === quote) quote = undefined;
      result += escaped ? "  " : " ";
    } else if (char === "#" && (i === 0 || /\s/.test(line[i - 1]!))) {
      break;
    } else {
      if (char === "'" || char === '"') quote = char;
      result += quote ? " " : char;
    }
  }
  return result;
}

/**
 * Report `<PLACEHOLDER>` tokens that the shell would parse as redirections.
 * Placeholders inside quotes and heredoc bodies are safe to paste.
 */
export function findUnquotedPlaceholders(script: string): SnippetIssue[] {
  const issues: SnippetIssue[] = [];
  let heredocEnd: string | undefined;
  script.split("\n").forEach((text, index) => {
    if (heredocEnd !== undefined) {
      if (text.trim() === heredocEnd) heredocEnd = undefined;
      return;
    }
    for (const match of unquotedText(text).matchAll(PLACEHOLDER)) {
      issues.push({
        line: index + 1,
        message: `Quote ${match[0]}; unquoted it is a shell redirection`,
      });
    }
    heredocEnd = HEREDOC_START.exec(text)?.[1];
  });
  return issues;
}

/** Report unquoted placeholders in inline `veryfront integration ...` code spans. */
export function findUnquotedInlineCommands(markdown: string): SnippetIssue[] {
  const issues: SnippetIssue[] = [];
  markdown.split("\n").forEach((line, index) => {
    for (const span of line.matchAll(/`(veryfront integration [^`]*)`/g)) {
      for (const issue of findUnquotedPlaceholders(span[1]!)) {
        issues.push({ line: index + 1, message: issue.message });
      }
    }
  });
  return issues;
}

/** Return GraphQL documents embedded as `<<'GRAPHQL'` heredocs in a shell snippet. */
export function extractGraphqlHeredocs(script: string): string[] {
  const documents: string[] = [];
  const pattern = /<<-?\s*'GRAPHQL'\n([\s\S]*?)\nGRAPHQL(?:\n|$)/g;
  for (const match of script.matchAll(pattern)) documents.push(match[1]!);
  return documents;
}

export interface GraphqlSchemaField {
  readonly type: string;
  readonly args: Readonly<Record<string, string>>;
}

export interface GraphqlSchemaType {
  readonly kind: string;
  readonly fields?: Readonly<Record<string, GraphqlSchemaField>>;
  readonly inputFields?: Readonly<Record<string, string>>;
}

export type GraphqlSchemaSnapshot = Readonly<Record<string, GraphqlSchemaType>>;

type Token = {
  readonly value: string;
  readonly kind: "name" | "punct" | "variable" | "literal" | "skip";
};

const TOKEN_PATTERNS: ReadonlyArray<readonly [Token["kind"], RegExp]> = [
  ["skip", /\s+|,|#.*/y],
  ["variable", /\$\w+/y],
  ["name", /[A-Z_a-z]\w*/y],
  ["punct", /\.\.\.|[{}():!=@[\]]/y],
  ["literal", /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?/y],
];

function tokenize(document: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < document.length) {
    const found = TOKEN_PATTERNS.map(([kind, pattern]) => {
      pattern.lastIndex = index;
      const match = pattern.exec(document);
      return match ? { kind, value: match[0] } : undefined;
    }).find((token) => token !== undefined);
    if (!found) {
      throw new Error(`Unexpected GraphQL character ${document[index]}`);
    }
    index += found.value.length;
    if (found.kind !== "skip") tokens.push(found);
  }
  return tokens;
}

function namedType(type: string): string {
  return type.replaceAll(/[[\]!]/g, "");
}

/** Recursive-descent reader for one operation over the supported GraphQL subset. */
class GraphqlOperationValidator {
  readonly issues: string[] = [];
  private position = 0;
  private readonly variables = new Map<string, string>();

  constructor(
    private readonly tokens: readonly Token[],
    private readonly schema: GraphqlSchemaSnapshot,
  ) {}

  validate(): void {
    const operation = this.next()?.value;
    if (operation !== "query" && operation !== "mutation") {
      throw new Error("Use a named query or mutation operation");
    }
    if (this.peek()?.kind === "name") this.next();
    if (this.peek()?.value === "(") this.readVariableDefinitions();
    this.readSelection(operation === "query" ? "Query" : "Mutation", operation);
    if (this.position !== this.tokens.length) {
      throw new Error("Unexpected content after the operation");
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private next(): Token | undefined {
    return this.tokens[this.position++];
  }

  private expect(value: string): void {
    const token = this.next();
    if (token?.value !== value) {
      throw new Error(
        `Expected "${value}" but found "${token?.value ?? "end of document"}"`,
      );
    }
  }

  private until(end: string): boolean {
    const token = this.peek();
    return token !== undefined && token.value !== end;
  }

  private readType(): string {
    let type: string;
    if (this.peek()?.value === "[") {
      this.next();
      type = `[${this.readType()}]`;
      this.expect("]");
    } else {
      type = this.next()?.value ?? "";
    }
    if (this.peek()?.value !== "!") return type;
    this.next();
    return `${type}!`;
  }

  private readVariableDefinitions(): void {
    this.expect("(");
    while (this.until(")")) {
      const variable = this.next()!;
      if (variable.kind !== "variable") {
        throw new Error(`Expected a variable, found ${variable.value}`);
      }
      this.expect(":");
      const type = this.readType();
      if (!this.schema[namedType(type)]) {
        this.issues.push(`Variable ${variable.value} has unknown type ${type}`);
      }
      this.variables.set(variable.value.slice(1), type);
    }
    this.expect(")");
  }

  private readArguments(
    field: GraphqlSchemaField | undefined,
    path: string,
  ): void {
    const provided = new Set<string>();
    if (this.peek()?.value === "(") {
      this.readArgumentList(field, path, provided);
    }
    for (const [arg, type] of Object.entries(field?.args ?? {})) {
      if (type.endsWith("!") && !provided.has(arg)) {
        this.issues.push(`${path}: missing required argument "${arg}"`);
      }
    }
  }

  private readArgumentList(
    field: GraphqlSchemaField | undefined,
    path: string,
    provided: Set<string>,
  ): void {
    this.expect("(");
    while (this.until(")")) {
      const arg = this.next()!.value;
      provided.add(arg);
      this.expect(":");
      const value = this.next()!;
      const argType = field?.args[arg];
      if (field && !argType) {
        this.issues.push(`${path}: unknown argument "${arg}"`);
      }
      if (value.kind === "variable") {
        this.checkVariable(value.value, arg, argType, path);
      }
    }
    this.expect(")");
  }

  private checkVariable(
    name: string,
    arg: string,
    argType: string | undefined,
    path: string,
  ) {
    const declared = this.variables.get(name.slice(1));
    if (!declared) {
      this.issues.push(`${path}: undeclared variable ${name}`);
    } else if (argType && declared !== argType) {
      this.issues.push(
        `${path}: ${name} is ${declared} but "${arg}" expects ${argType}`,
      );
    }
  }

  private readSelection(typeName: string, path: string): void {
    const type = this.schema[typeName];
    this.expect("{");
    while (this.until("}")) {
      const name = this.next()!.value;
      if (name === "..." || name === "@") {
        throw new Error(
          `${path}: fragments and directives are not supported by this check`,
        );
      }
      const field = type?.fields?.[name];
      if (!field) {
        this.issues.push(`${path}: ${typeName} has no field "${name}"`);
      }
      const fieldPath = `${path}.${name}`;
      this.readArguments(field, fieldPath);
      this.readFieldSelection(field, fieldPath);
    }
    this.expect("}");
  }

  private readFieldSelection(
    field: GraphqlSchemaField | undefined,
    path: string,
  ): void {
    const target = field ? namedType(field.type) : "";
    const kind = this.schema[target]?.kind;
    const hasSelection = this.peek()?.value === "{";
    if (hasSelection && (kind === "SCALAR" || kind === "ENUM")) {
      this.issues.push(`${path}: scalar field cannot have a selection`);
    }
    if (hasSelection) this.readSelection(target, path);
    else if (kind === "OBJECT") {
      this.issues.push(`${path}: object field needs a selection`);
    }
  }
}

/**
 * Validate one GraphQL operation's root field, arguments, variable types and
 * nested selections against a schema snapshot. Fragments and directives are
 * outside this subset and are reported rather than ignored.
 */
export function validateGraphqlOperation(
  document: string,
  schema: GraphqlSchemaSnapshot,
): string[] {
  let validator: GraphqlOperationValidator;
  try {
    validator = new GraphqlOperationValidator(tokenize(document), schema);
  } catch (error) {
    return [(error as Error).message];
  }
  try {
    validator.validate();
  } catch (error) {
    validator.issues.push((error as Error).message);
  }
  return validator.issues;
}

const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["Stripe live or test key", /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Literal bearer credential", /Bearer (?![<$])[\w.~+/-]{24,}/],
];

/** Report credential-shaped literals. Placeholders such as `<TOKEN>` pass. */
export function findSecretLiterals(text: string): SnippetIssue[] {
  const issues: SnippetIssue[] = [];
  text.split("\n").forEach((line, index) => {
    for (const [label, pattern] of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        issues.push({ line: index + 1, message: `${label} literal` });
      }
    }
  });
  return issues;
}

/** Report `veryfront integration <subcommand>` references that the CLI does not define. */
export function findUnknownIntegrationSubcommands(
  text: string,
  subcommands: readonly string[],
): SnippetIssue[] {
  const issues: SnippetIssue[] = [];
  text.split("\n").forEach((line, index) => {
    for (
      const match of line.matchAll(/veryfront integration ([a-z][a-z-]*)/g)
    ) {
      if (!subcommands.includes(match[1]!)) {
        issues.push({
          line: index + 1,
          message: `Unknown integration subcommand "${match[1]}"`,
        });
      }
    }
  });
  return issues;
}

/** Read the subcommand list from a usage string such as `veryfront integration <a|b> ...`. */
export function parseSubcommandUsage(usage: string): string[] {
  const match = /<([a-z|-]+)>/.exec(usage);
  return match ? match[1]!.split("|") : [];
}

/**
 * Rewrite public `veryfront/*` specifiers to the package export targets so a
 * snippet typechecks against this checkout. Unknown specifiers are left as-is
 * and fail the typecheck.
 */
export function rewritePublicImports(
  code: string,
  exports: Readonly<Record<string, string>>,
  toUrl: (target: string) => string,
): string {
  return code.replaceAll(
    /(from\s+|import\s*\(\s*)"(veryfront(?:\/[^"]+)?)"/g,
    (whole, prefix: string, specifier: string) => {
      const key = specifier === "veryfront"
        ? "."
        : `./${specifier.slice("veryfront/".length)}`;
      const target = exports[key];
      return target ? `${prefix}"${toUrl(target)}"` : whole;
    },
  );
}

/** The TypeScript first-call script and the Node commands the guide gives for it. */
export interface NodeFirstCall {
  readonly script: string;
  readonly setup: string;
  readonly fileName: string;
  readonly run: string;
}

/**
 * Read the "Call with TypeScript" section: its `ts` fence, the `bash` fence
 * that runs `npm init -y`, and the `bash` fence that runs `node <file>`.
 */
export function extractNodeFirstCall(
  markdown: string,
  heading = "### Call with TypeScript",
): NodeFirstCall {
  const start = markdown.indexOf(`${heading}\n`);
  if (start < 0) throw new Error(`Missing section "${heading}"`);
  const next = markdown.indexOf("\n### ", start + heading.length);
  const fences = extractFences(
    markdown.slice(start, next < 0 ? undefined : next),
  );
  const script = fences.find((fence) => fence.lang === "ts")?.code;
  const setup = fences.find((fence) =>
    fence.lang === "bash" && /^npm init -y$/m.test(fence.code)
  )?.code;
  const run = fences.find((fence) =>
    fence.lang === "bash" && /^node \S+$/.test(fence.code.trim())
  )?.code.trim();
  if (script === undefined) throw new Error(`No ts fence under "${heading}"`);
  if (setup === undefined) {
    throw new Error(`No bash fence with "npm init -y" under "${heading}"`);
  }
  if (run === undefined) {
    throw new Error(`No bash fence with "node <file>" under "${heading}"`);
  }
  return { script, setup, fileName: run.slice("node ".length), run };
}

/**
 * Build a bash script that runs the guide's Node setup and run commands as
 * printed. `npm install veryfront` installs the local package at
 * `$VERYFRONT_PACKAGE` so the check needs no registry, and the script file is
 * copied from `$SNIPPET`. `dropModuleType` removes `npm pkg set type=module`
 * to show that the check fails without it.
 */
export function nodeFirstCallScript(
  call: NodeFirstCall,
  options: { dropModuleType?: boolean } = {},
): string {
  const setup = options.dropModuleType
    ? call.setup.split("\n").filter((line) =>
      line.trim() !== "npm pkg set type=module"
    ).join("\n")
    : call.setup;
  return [
    "set -euo pipefail",
    "npm() {",
    '  if [ "$*" = "install veryfront" ]; then',
    '    command npm install --offline --no-audit --no-fund "$VERYFRONT_PACKAGE"',
    "  else",
    '    command npm "$@"',
    "  fi",
    "}",
    setup,
    `cp "$SNIPPET" ${call.fileName}`,
    call.run,
    "",
  ].join("\n");
}
