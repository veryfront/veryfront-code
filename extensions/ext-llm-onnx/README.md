# @veryfront/ext-llm-onnx

Run curated language and embedding models in the Veryfront server process with
Transformers.js and ONNX Runtime. The provider keeps the existing `local/*`
model identifiers.

## Install

Install the extension and its optional runtime peer:

```bash
npm install @veryfront/ext-llm-onnx @huggingface/transformers
```

Until `@huggingface/transformers` adopts the patched transitive releases,
applications using npm should pin them at the application root:

```json
{
  "overrides": {
    "adm-zip": "0.6.0",
    "sharp": "0.35.3"
  }
}
```

## Register

```ts
import extOnnx from "@veryfront/ext-llm-onnx";
import { defineConfig } from "veryfront";

export default defineConfig({
  extensions: [extOnnx()],
});
```

Use a local model from an agent:

```ts
import { defineAgent } from "veryfront/agent";

export default defineAgent({
  name: "local-assistant",
  model: "local/qwen3.5-0.8b",
  instructions: "Answer concisely.",
});
```

Model files download on first use and are cached under `.cache/models`.
Transformers.js and native ONNX Runtime are loaded lazily. Compiled Veryfront
binaries do not support this runtime.
