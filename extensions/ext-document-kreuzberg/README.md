# @veryfront/ext-document-kreuzberg

> **Category:** Document extraction | **Contract:** `DocumentExtractor` | **Built-in**

Document text extraction for Veryfront via kreuzberg.

This extension registers the `DocumentExtractor` contract and keeps kreuzberg
out of core.

```ts
import extDocumentKreuzberg from "@veryfront/ext-document-kreuzberg";

export default {
  extensions: [extDocumentKreuzberg()],
};
```
