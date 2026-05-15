# @veryfront/ext-document-kreuzberg

> **Category:** Document extraction | **Contract:** `DocumentExtractor` |
> **Built-in**

Document text extraction for Veryfront via kreuzberg.

This extension registers the `DocumentExtractor` contract and keeps kreuzberg
out of core.

## Supply-chain boundary

This extension is a sensitive document extraction boundary. Keep
`@kreuzberg/wasm` and related document parsing dependencies in this extension
instead of importing them from core, CLI, React, or unrelated extensions.

```ts
import extDocumentKreuzberg from "@veryfront/ext-document-kreuzberg";

export default {
  extensions: [extDocumentKreuzberg()],
};
```
