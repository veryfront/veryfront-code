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
    const heredoc = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(text);
    let quote: string | undefined;
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;
      if (quote) {
        if (char === "\\" && quote === '"') i++;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === "#" && (i === 0 || /\s/.test(text[i - 1]!))) break;
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      PLACEHOLDER.lastIndex = i;
      const match = PLACEHOLDER.exec(text);
      if (match && match.index === i) {
        issues.push({
          line: index + 1,
          message: `Quote ${match[0]}; unquoted it is a shell redirection`,
        });
        i += match[0].length - 1;
      }
    }
    if (heredoc) heredocEnd = heredoc[1];
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
  readonly kind: "name" | "punct" | "variable";
};

function tokenize(document: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /\s+|#[^\n]*|(\$[_A-Za-z][_0-9A-Za-z]*)|([_A-Za-z][_0-9A-Za-z]*)|(\.\.\.|[{}():!\[\]=@,])|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?)/y;
  let index = 0;
  while (index < document.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(document);
    if (!match) {
      throw new Error(`Unexpected GraphQL character ${document[index]}`);
    }
    index = pattern.lastIndex;
    if (match[1]) tokens.push({ kind: "variable", value: match[1] });
    else if (match[2]) tokens.push({ kind: "name", value: match[2] });
    else if (match[3] && match[3] !== ",") {
      tokens.push({ kind: "punct", value: match[3] });
    } else if (match[4] || match[5]) {
      tokens.push({ kind: "name", value: "<literal>" });
    }
  }
  return tokens;
}

function namedType(type: string): string {
  return type.replaceAll(/[\[\]!]/g, "");
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
  const issues: string[] = [];
  let tokens: Token[];
  try {
    tokens = tokenize(document);
  } catch (error) {
    return [(error as Error).message];
  }
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const expect = (value: string) => {
    const token = next();
    if (token?.value !== value) {
      throw new Error(
        `Expected "${value}" but found "${token?.value ?? "end of document"}"`,
      );
    }
  };
  const readType = (): string => {
    let type = "";
    if (peek()?.value === "[") {
      next();
      type = `[${readType()}]`;
      expect("]");
    } else {
      type = next()?.value ?? "";
    }
    if (peek()?.value === "!") {
      next();
      type += "!";
    }
    return type;
  };
  const variables = new Map<string, string>();

  const readSelection = (typeName: string, path: string) => {
    const type = schema[typeName];
    expect("{");
    while (peek() && peek()!.value !== "}") {
      const token = next()!;
      if (token.value === "..." || token.value === "@") {
        throw new Error(
          `${path}: fragments and directives are not supported by this check`,
        );
      }
      const field = type?.fields?.[token.value];
      if (!field) {
        issues.push(`${path}: ${typeName} has no field "${token.value}"`);
      }
      if (peek()?.value === "(") {
        next();
        while (peek() && peek()!.value !== ")") {
          const arg = next()!.value;
          expect(":");
          const value = next()!;
          const argType = field?.args[arg];
          if (field && !argType) {
            issues.push(`${path}.${token.value}: unknown argument "${arg}"`);
          }
          if (value.kind === "variable") {
            const declared = variables.get(value.value.slice(1));
            if (!declared) {
              issues.push(
                `${path}.${token.value}: undeclared variable ${value.value}`,
              );
            } else if (argType && declared !== argType) {
              issues.push(
                `${path}.${token.value}: ${value.value} is ${declared} but "${arg}" expects ${argType}`,
              );
            }
          }
        }
        expect(")");
      }
      const target = field ? namedType(field.type) : undefined;
      const targetKind = target ? schema[target]?.kind : undefined;
      if (peek()?.value === "{") {
        if (field && (targetKind === "SCALAR" || targetKind === "ENUM")) {
          issues.push(
            `${path}.${token.value}: scalar field cannot have a selection`,
          );
        }
        readSelection(target ?? "", `${path}.${token.value}`);
      } else if (field && targetKind === "OBJECT") {
        issues.push(`${path}.${token.value}: object field needs a selection`);
      }
    }
    expect("}");
  };

  try {
    const operation = next()?.value;
    if (operation !== "query" && operation !== "mutation") {
      throw new Error("Use a named query or mutation operation");
    }
    if (peek()?.kind === "name") next();
    if (peek()?.value === "(") {
      next();
      while (peek() && peek()!.value !== ")") {
        const variable = next()!;
        if (variable.kind !== "variable") {
          throw new Error(`Expected a variable, found ${variable.value}`);
        }
        expect(":");
        const type = readType();
        if (!schema[namedType(type)]) {
          issues.push(`Variable ${variable.value} has unknown type ${type}`);
        }
        variables.set(variable.value.slice(1), type);
      }
      expect(")");
    }
    readSelection(operation === "query" ? "Query" : "Mutation", operation);
    if (position !== tokens.length) {
      throw new Error("Unexpected content after the operation");
    }
  } catch (error) {
    issues.push((error as Error).message);
  }
  return issues;
}

const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["Stripe live or test key", /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Literal bearer credential", /Bearer (?![<$])[A-Za-z0-9._~+\/-]{24,}/],
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
