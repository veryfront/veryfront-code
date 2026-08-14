import { isNode, parseAllDocuments, visit } from "yaml";
import {
  createSkillDocumentParserProvider,
  createYamlParserProvider,
  type SkillDocumentParserProvider,
  type YamlParseOptions,
  type YamlParserProvider,
} from "veryfront/extensions/parser";

/**
 * The tags a JSON-representable document may carry explicitly. `yaml`'s
 * `Schema.knownTags` fallback resolves YAML 1.1 tags such as `!!binary`,
 * `!!timestamp`, `!!set` and `!!omap` even under the 1.2 core schema without
 * raising a warning, so the parser options alone cannot express
 * `@std/yaml`'s JSON schema. Rejecting every other explicit tag does.
 */
const JSON_SCHEMA_TAGS: ReadonlySet<string> = new Set([
  "tag:yaml.org,2002:map",
  "tag:yaml.org,2002:seq",
  "tag:yaml.org,2002:str",
  "tag:yaml.org,2002:null",
  "tag:yaml.org,2002:bool",
  "tag:yaml.org,2002:int",
  "tag:yaml.org,2002:float",
]);

function assertJsonRepresentableTags(document: unknown): void {
  visit(document as Parameters<typeof visit>[0], (_key, node) => {
    if (!isNode(node)) return;
    const tag = node.tag;
    if (typeof tag === "string" && !JSON_SCHEMA_TAGS.has(tag)) {
      throw new SyntaxError(`Cannot resolve unknown tag !<${tag}>`);
    }
  });
}

/**
 * Run a synchronous parse with any own `value` property lifted off
 * `Object.prototype`.
 *
 * `yaml` builds its AST by assigning `this.value = …` on class instances. A
 * poisoned non-writable `Object.prototype.value` makes strict mode reject
 * every one of those assignments, so no document parses at all. Surviving a
 * poisoned `Object.prototype` is an invariant the framework asserts across its
 * Skill and agent trust boundaries, and `@std/yaml` happened to satisfy it, so
 * the property is lifted for the duration of the parse and restored
 * afterwards.
 *
 * Nothing can observe the gap: the parse is synchronous, never yields, and
 * invokes no caller-supplied code (no custom tags, no reviver).
 */
function withoutPollutedValuePrototype<T>(run: () => T): T {
  const polluted = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  if (polluted === undefined || polluted.configurable !== true) return run();

  Reflect.deleteProperty(Object.prototype, "value");
  try {
    return run();
  } finally {
    Object.defineProperty(Object.prototype, "value", polluted);
  }
}

/**
 * Decode one YAML document with `@std/yaml`-compatible failure behaviour.
 *
 * `yaml` reports most problems on the returned document instead of throwing,
 * and raises `YAMLParseError` rather than `SyntaxError` when it does throw.
 * Both are normalised here so call sites keep the single `SyntaxError`
 * contract they were written against.
 */
export function parseYamlSource(
  source: string,
  options: YamlParseOptions = {},
): unknown {
  return withoutPollutedValuePrototype(() => decodeDocument(source, options));
}

function decodeDocument(source: string, options: YamlParseOptions): unknown {
  const jsonSchema = options.schema === "json";

  let documents;
  try {
    documents = parseAllDocuments(source, {
      uniqueKeys: options.allowDuplicateKeys !== true,
      // Forwarded, not merely recorded: without it the parser runs the core
      // schema and resolves `0o7` to 7, which is exactly the widening
      // `schema: "json"` is asked for at a trust boundary.
      schema: jsonSchema ? "json" : "core",
      // Warnings are inspected below; left to the library they would be
      // written straight to the host process's stderr.
      logLevel: "silent",
    });
  } catch (cause) {
    throw new SyntaxError(cause instanceof Error ? cause.message : String(cause), { cause });
  }

  if (documents.length === 0) return null;
  if (documents.length > 1) {
    throw new SyntaxError(
      "Found more than 1 document in the stream: expected a single document",
    );
  }

  const document = documents[0]!;
  // An unresolved tag is a warning in `yaml` and an error in `@std/yaml`.
  // Treat it as an error: a tag the parser did not understand means the
  // decoded value is not the one the document asked for.
  //
  // `TAG_RESOLVE_FAILED` is the exception, and only under the JSON schema,
  // where it fires for every ordinary unquoted string -- `name: code-review`
  // raises it twice. It is filtered per diagnostic rather than by taking the
  // first: a document that raises it also raises the real ones beside it, so
  // reading `errors[0]` would report the benign one and hide `BAD_INDENT` or
  // `DUPLICATE_KEY` behind it.
  const problem = [...document.errors, ...document.warnings].find(
    (diagnostic) => !(jsonSchema && diagnostic.code === "TAG_RESOLVE_FAILED"),
  );
  if (problem) throw new SyntaxError(problem.message, { cause: problem });

  if (jsonSchema) assertJsonRepresentableTags(document);

  return document.toJS();
}

/** Create the official `yaml`-backed general YAML parser. */
export function createYamlParser(): Readonly<YamlParserProvider> {
  return createYamlParserProvider(parseYamlSource);
}

/**
 * Create the official `yaml`-backed Skill frontmatter parser.
 *
 * The name predates the move off `@std/yaml`; it is the export name
 * `src/extensions/parser/skill-defaults.ts` looks up in the published package,
 * so it stays put.
 */
export function createStdYamlSkillDocumentParserProvider(): Readonly<
  SkillDocumentParserProvider
> {
  return createSkillDocumentParserProvider((source) =>
    parseYamlSource(source, {
      allowDuplicateKeys: false,
      schema: "json",
    })
  );
}
