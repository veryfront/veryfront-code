# @veryfront/ext-yaml

> **Category:** Parser | **Contract:** `SkillDocumentParserProvider`

Provides synchronous YAML decoding for Veryfront Skill document frontmatter,
backed by the pinned `@std/yaml` implementation.

Veryfront core owns the `SKILL.md` frontmatter envelope, document limits,
mapping-root validation, immutable snapshots, and Skill metadata policy. This
extension receives only the YAML source between the delimiters and returns the
decoded, untrusted value. Keeping that boundary narrow prevents YAML parser
details and third-party dependencies from entering core.

## Activation

The package declares automatic activation. Once `@veryfront/ext-yaml` is
installed, the standard Veryfront server bootstrap discovers it and registers
`SkillDocumentParserProvider` before project capability discovery. Core fails
closed when no parser extension is installed; it does not reinterpret malformed
YAML with a partial built-in grammar.

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
import { createStdYamlSkillDocumentParserProvider } from "@veryfront/ext-yaml";

const parser = createStdYamlSkillDocumentParserProvider();
const decoded = parser.parseFrontmatter("name: example");
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
