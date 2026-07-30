# @veryfront/ext-llm-transformers

Run explicitly selected language and embedding models on the server through
Transformers.js. The extension owns the third-party inference dependency,
model catalog, cache, and native pipeline lifecycle; the `veryfront` core
package contains only provider-neutral contracts.

## Enable local inference

Install this package alongside `veryfront`, then compose it explicitly in
`veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";
import extTransformers from "@veryfront/ext-llm-transformers";

export default defineConfig({
  extensions: [extTransformers()],
});
```

Select a local model in an agent:

```ts
import { agent } from "veryfront/agent";

export default agent({
  model: "local/qwen3.5-0.8b",
  system: "You are a helpful assistant.",
});
```

The extension is not auto-enabled and core does not probe for it. Resolving a
`local/*` model without composing the extension fails with an actionable
provider-registration error.

## Supported language models

| Model string          | Runtime class          | Approximate download |
| --------------------- | ---------------------- | -------------------- |
| `local/qwen3.5-0.8b`  | Conditional generation | 900 MB               |
| `local/gemma4-e2b-it` | Conditional generation | 1.8 GB               |
| `local/gemma4-e4b-it` | Conditional generation | 6 GB                 |

Language-model aliases are curated and fail closed when unknown. Embeddings
support the curated aliases exported by the package and bounded explicit
Hugging Face repository identifiers in `owner/model` form.

The language models in this package support text prompts and text responses.
They explicitly disable tool calling and structured output; unsupported request
options fail before model preparation instead of being ignored.

## Runtime settings

| Environment variable                       | Values                                     | Default   |
| ------------------------------------------ | ------------------------------------------ | --------- |
| `VERYFRONT_LOCAL_AI_DEVICE`                | `cpu`, `webgpu`                            | `cpu`     |
| `VERYFRONT_LOCAL_AI_THINKING`              | `1`, `true`, `yes`, `on`, or false forms   | off       |
| `VERYFRONT_LOCAL_AI_MODEL_LOAD_TIMEOUT_MS` | Positive integer, no greater than 86400000 | `7200000` |
| `VERYFRONT_DISABLE_LOCAL_AI`               | `1` to reject local inference              | unset     |
| `HF_TOKEN`                                 | Hugging Face token for private models      | unset     |

Requesting WebGPU without an available adapter fails closed; the extension
does not silently retry on CPU. Model files are cached under `.cache/models`.
The cold-load deadline covers download and native model initialization. Caller
cancellation and extension teardown also stop waiting immediately. Transformers.js
4.2 does not expose a supported download abort signal, so any vendor load that
finishes after cancellation is detached and its native value is disposed. Until
that happens, it continues to occupy a bounded load slot so repeated timeouts
cannot accumulate unbounded native work.

Generated responses report `length` when they exhaust the configured output-token
limit and `stop` for EOS, configured stop sequences, or other model-owned stop
conditions. Streaming is pull-driven. The extension keeps a bounded output bridge
and aborts generation with a backpressure error if a consumer cannot keep up.

## Verify the installation

Run the smoke entry point from a repository checkout:

```bash
VERYFRONT_LOCAL_AI_DEVICE=webgpu \
  deno run -A extensions/ext-llm-transformers/src/_smoke-test.ts
```

For Gemma, select the model explicitly:

```bash
VERYFRONT_LOCAL_AI_MODEL=gemma4-e2b-it \
  deno run -A extensions/ext-llm-transformers/src/_smoke-test.ts
```

The first request downloads the selected model. Import failures are reported
as local-runtime availability errors before response headers are committed;
download, configuration, and model-initialization failures retain their
original error type and cause.
