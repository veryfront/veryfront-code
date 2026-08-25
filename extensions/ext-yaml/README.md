# @veryfront/ext-yaml

> **Category:** Parser | **Contracts:** `SkillDocumentParserProvider`,
> `YamlParserProvider`

Provides synchronous YAML decoding for Veryfront, backed by the pinned `yaml`
(eemeli) implementation. It satisfies two contracts: the narrow
`SkillDocumentParserProvider` used at the Skill document trust boundary, and the
general `YamlParserProvider` that core's `#std/yaml/parse` compatibility shim
resolves for front matter and MDX.

Veryfront core owns the `SKILL.md` frontmatter envelope, document limits,
mapping-root validation, immutable snapshots, and Skill metadata policy. This
extension receives only the YAML source between the delimiters and returns the
decoded, untrusted value. Keeping that boundary narrow prevents YAML parser
details and third-party dependencies from entering core. Core may depend on
the Deno standard library and nothing else, so the parser must live here.

## YAML version

`yaml` implements YAML 1.2. `jsr:@std/yaml`, which this extension previously
wrapped, implements YAML 1.1. Three resolution differences are deliberate and
covered by tests:

| Source                | YAML 1.1 (`@std/yaml`) | YAML 1.2 (this extension) |
| --------------------- | ---------------------- | ------------------------- |
| `a: 1_000`            | `1000`                 | `"1_000"`                 |
| `created: 2024-01-02` | `Date`                 | `"2024-01-02"`            |
| `<<: *anchor`         | merged into the map    | a literal `"<<"` key      |

`schema: "json"` additionally rejects every explicit tag outside the JSON core
set, so `!!binary`, `!!timestamp`, `!!set` and unknown tags raise `SyntaxError`
rather than decoding into implementation-specific values.

## Activation

The package declares automatic activation. Once `@veryfront/ext-yaml` is
installed, the standard Veryfront server bootstrap discovers it and registers
both contracts before project capability discovery. Core fails closed when no
parser extension is installed; it does not reinterpret malformed YAML with a
partial built-in grammar.

Composition roots that do not run standard extension discovery can register the
factory explicitly:

```ts
import extYaml from "@veryfront/ext-yaml";
import { defineConfig } from "veryfront";

export default defineConfig({
  extensions: [extYaml()],
});
```

## Direct composition

Composition roots that manage contracts directly can create the immutable
provider without running the extension lifecycle:

```ts
import { createStdYamlSkillDocumentParserProvider, createYamlParser } from "@veryfront/ext-yaml";

const skillParser = createStdYamlSkillDocumentParserProvider();
const decoded = skillParser.parseFrontmatter("name: example");

const yamlParser = createYamlParser();
const value = yamlParser.parseYaml("name: example", { schema: "json" });
```

The return value remains `unknown`; callers must enforce their own mapping and
metadata policy. Malformed YAML, duplicate mapping keys, and multi-document
streams are rejected by the parser.

## Configuration

No factory options. The extension takes no config.

## Development tasks

| Task              | Purpose                                    |
| ----------------- | ------------------------------------------ |
| `deno task test`  | Run the extension test suite.              |
| `deno task check` | Type-check the extension source and tests. |
