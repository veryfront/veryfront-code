# @veryfront/ext-parser-parse5

> **Category:** Build | **Contract:** `HTMLHeadLocator` | **Built-in**

Provides bounded HTML head location for Veryfront. The initial implementation
admits at most 8 MiB of UTF-8 input and returns a conservative placement that
does not authorize insertion. Parser-backed placement is added with explicit
resource budgets in a later implementation stage.

## Registration

The extension factory registers `HTMLHeadLocator` through the standard
Veryfront extension context.

```ts
import extParse5 from "@veryfront/ext-parser-parse5";

export default defineConfig({
  extensions: [extParse5()],
});
```

## Parser-only entry

Import `Parse5HTMLHeadLocator` from
`@veryfront/ext-parser-parse5/parser-only` when extension lifecycle registration
is not needed. This entry does not load or execute parse5 in the initial
bounded-admission implementation.

## Configuration

No factory options. The extension takes no config.
