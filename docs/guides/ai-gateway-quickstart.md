---
title: "AI Gateway quickstart"
description: "Connect a coding harness or an AI SDK to the Veryfront Cloud AI Gateway with one snippet."
order: 57
---

Point a coding harness or an AI SDK at the Veryfront Cloud AI Gateway with a
Veryfront API key. Pick your tool below and copy its snippet. For agents defined
inside a Veryfront project, see [Providers](./providers.md) instead.

## Prerequisites

- A Veryfront API key with the Write permission. Inference requests are writes,
  so a Read-only key is refused.
- The project slug, when you use an account key (see
  [Base URLs and key types](#base-urls-and-key-types)).

The snippets read the key from `VERYFRONT_API_KEY`:

```bash
export VERYFRONT_API_KEY="<API_KEY>"
```

## Base URLs and key types

| Protocol                                | Base URL                              |
| --------------------------------------- | ------------------------------------- |
| OpenAI (Chat Completions and Responses) | `https://api.veryfront.com/ai/v1`     |
| Anthropic Messages                      | `https://api.veryfront.com/ai/v1`     |
| Gemini                                  | `https://api.veryfront.com/ai/v1beta` |

Anthropic clients append `/v1/messages` to their base URL, so Claude Code and
the official Anthropic SDK take `https://api.veryfront.com/ai`. Clients that
take a full version path, such as the Vercel AI SDK, use
`https://api.veryfront.com/ai/v1`.

Send the key as a Bearer token in the `Authorization` header. Anthropic clients
can send it in `x-api-key` instead.

| Key type    | Scope                                                           | Extra header                               |
| ----------- | --------------------------------------------------------------- | ------------------------------------------ |
| Project key | One project. Create it in Studio under **Settings > API Keys**. | None                                       |
| Account key | Your account. It is not bound to one project.                   | `x-veryfront-project-slug: <PROJECT_SLUG>` |

Use a project key. It is bound to one project, so every request is attributed
to that project without an extra header. An account key must name the project
on every request, or the gateway refuses it.

## Choose a model

Name models as `<provider>/<model>`. List the models your key can use:

```bash
curl https://api.veryfront.com/ai/v1/models \
  -H "Authorization: Bearer $VERYFRONT_API_KEY"
```

With an account key, add `-H "x-veryfront-project-slug: <PROJECT_SLUG>"` to
this command and to the `curl` command in
[Verify it worked](#verify-it-worked). Client configuration does not apply to
`curl`.

The response uses the OpenAI list shape. Copy the `id` of a model, for example
`anthropic/claude-sonnet-4-6`, into your tool. Each base URL lists only the
models it serves, so an id from this list works on `/ai/v1`. The examples below
use example ids; replace them with ids from your list.

## Coding harnesses

### Claude Code

```bash
export ANTHROPIC_BASE_URL="https://api.veryfront.com/ai"
export ANTHROPIC_AUTH_TOKEN="$VERYFRONT_API_KEY"
claude --model anthropic/claude-sonnet-4-6
```

With an account key, also set the project header:

```bash
export ANTHROPIC_CUSTOM_HEADERS="x-veryfront-project-slug: <PROJECT_SLUG>"
```

To show the gateway's models in the `/model` picker, set
`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`. See
[Connect Claude Code to an LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect).

### Codex CLI

Add a provider to `~/.codex/config.toml`:

```toml
model = "openai/gpt-5.4-mini"
model_provider = "veryfront"
web_search = "disabled"

[model_providers.veryfront]
name = "Veryfront AI Gateway"
base_url = "https://api.veryfront.com/ai/v1"
env_key = "VERYFRONT_API_KEY"
wire_api = "responses"
```

With an account key, also add the project header to `config.toml`:

```toml
[model_providers.veryfront.http_headers]
"x-veryfront-project-slug" = "<PROJECT_SLUG>"
```

Codex uses the Responses API, so choose a model that supports it. See the
[Codex configuration reference](https://developers.openai.com/codex/config-reference).

### Aider

Aider reaches OpenAI-compatible APIs through `OPENAI_API_BASE`. Prefix the
model id with `openai/`:

```bash
export OPENAI_API_BASE="https://api.veryfront.com/ai/v1"
export OPENAI_API_KEY="$VERYFRONT_API_KEY"
aider --model openai/mistral/mistral-small-2503
```

With an account key, add the header in `.aider.model.settings.yml`:

```yaml
- name: aider/extra_params
  extra_params:
    extra_headers:
      x-veryfront-project-slug: <PROJECT_SLUG>
```

See [Aider OpenAI-compatible APIs](https://aider.chat/docs/llms/openai-compat.html).

### Continue

Add a model with `provider: openai` and `apiBase` to `~/.continue/config.yaml`,
and store the key as a Continue secret named `VERYFRONT_API_KEY`:

```yaml
name: Veryfront
version: 0.0.1
schema: v1

models:
  - name: Veryfront Mistral Small
    provider: openai
    model: mistral/mistral-small-2503
    apiBase: https://api.veryfront.com/ai/v1
    apiKey: ${{ secrets.VERYFRONT_API_KEY }}
```

With an account key, add `requestOptions` to the same model entry:

```yaml
models:
  - name: Veryfront Mistral Small
    provider: openai
    model: mistral/mistral-small-2503
    apiBase: https://api.veryfront.com/ai/v1
    apiKey: ${{ secrets.VERYFRONT_API_KEY }}
    requestOptions:
      headers:
        x-veryfront-project-slug: <PROJECT_SLUG>
```

See [Continue OpenAI provider](https://docs.continue.dev/customize/model-providers/top-level/openai).

### OpenCode

Add a custom OpenAI-compatible provider to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "veryfront": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Veryfront AI Gateway",
      "options": {
        "baseURL": "https://api.veryfront.com/ai/v1",
        "apiKey": "{env:VERYFRONT_API_KEY}"
      },
      "models": {
        "mistral/mistral-small-2503": {
          "name": "Mistral Small"
        }
      }
    }
  }
}
```

With an account key, add `"headers": { "x-veryfront-project-slug": "<PROJECT_SLUG>" }`
to `options`. See [OpenCode providers](https://opencode.ai/docs/providers/).

### Cursor

Cursor's documentation describes its own API keys for OpenAI, Anthropic,
Google, Azure OpenAI, and AWS Bedrock, and routes requests through Cursor's
servers. It does not document a custom OpenAI-compatible base URL, so this
guide does not cover Cursor. See [Cursor API keys](https://cursor.com/docs/settings/api-keys).

## SDKs

With an account key, add the `x-veryfront-project-slug` header through the
client's default headers option: `defaultHeaders` in the OpenAI and Anthropic
TypeScript SDKs, `default_headers` in Python, `headers` in the Vercel AI SDK,
and `httpOptions.headers` in Google GenAI.

### OpenAI SDK (TypeScript)

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.veryfront.com/ai/v1",
  apiKey: process.env.VERYFRONT_API_KEY,
});

const completion = await client.chat.completions.create({
  model: "mistral/mistral-small-2503",
  messages: [{ role: "user", content: "Say hello." }],
});
console.log(completion.choices[0]?.message.content);
```

### OpenAI SDK (Python)

```python
import os

from openai import OpenAI

client = OpenAI(
    base_url="https://api.veryfront.com/ai/v1",
    api_key=os.environ["VERYFRONT_API_KEY"],
)

completion = client.chat.completions.create(
    model="mistral/mistral-small-2503",
    messages=[{"role": "user", "content": "Say hello."}],
)
print(completion.choices[0].message.content)
```

### Anthropic SDK (TypeScript)

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "https://api.veryfront.com/ai",
  apiKey: null,
  authToken: process.env.VERYFRONT_API_KEY,
});

const message = await client.messages.create({
  model: "anthropic/claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Say hello." }],
});
console.log(message.content);
```

### Vercel AI SDK

Use `createOpenAI` for OpenAI-protocol models. `.chat()` selects Chat
Completions; the default model function uses the Responses API:

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const veryfront = createOpenAI({
  baseURL: "https://api.veryfront.com/ai/v1",
  apiKey: process.env.VERYFRONT_API_KEY,
});

const { text } = await generateText({
  model: veryfront.chat("mistral/mistral-small-2503"),
  prompt: "Say hello.",
});
console.log(text);
```

Use `createAnthropic` for Anthropic models. Its base URL includes `/v1`:

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

const veryfront = createAnthropic({
  baseURL: "https://api.veryfront.com/ai/v1",
  authToken: process.env.VERYFRONT_API_KEY,
});

const { text } = await generateText({
  model: veryfront("anthropic/claude-sonnet-4-6"),
  prompt: "Say hello.",
});
console.log(text);
```

### LangChain (Python)

```python
import os

from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="mistral/mistral-small-2503",
    base_url="https://api.veryfront.com/ai/v1",
    api_key=os.environ["VERYFRONT_API_KEY"],
)

print(llm.invoke("Say hello.").content)
```

### Google GenAI (TypeScript)

The Gemini client adds the API version to its base URL, so `/ai` plus the
default `v1beta` reaches `/ai/v1beta`. Gemini models can be named with or
without the `google/` prefix:

```ts
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.VERYFRONT_API_KEY,
  httpOptions: { baseUrl: "https://api.veryfront.com/ai" },
});

const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: "Say hello.",
});
console.log(response.text);
```

## Known client quirks

- **Codex web search.** Codex sends its hosted `web_search` tool by default,
  and the gateway does not serve that tool yet, so the request is refused. Keep
  `web_search = "disabled"` in `config.toml`, or pass
  `-c web_search=disabled` for one run.
- **Claude Code refusals.** Claude Code prefixes every HTTP 403 with
  `Failed to authenticate`, including a refusal for a model or feature the
  project does not allow. Read the reason after `API Error: 403`. If the key
  works with the `curl` model list above, the refusal is about the request, not
  the key.
- **Codex retries.** Codex retries a refused request five more times by
  default before it shows the error, so a 403 can look like a hang. Set
  `stream_max_retries = 0` in the provider block while you debug.

## Verify it worked

Send one request with the key. A `200` response with a model reply means the
key, base URL, and model id are correct:

```bash
curl https://api.veryfront.com/ai/v1/chat/completions \
  -H "Authorization: Bearer $VERYFRONT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"mistral/mistral-small-2503","messages":[{"role":"user","content":"Say hello."}]}'
```

A `401` means the key is missing or invalid. A `400` that asks for a project
means an account key without the `x-veryfront-project-slug` header.

## Related

- [Providers](./providers.md) for inference inside a Veryfront project.
- [Configuration](./configuration.md#veryfront-cloud-model-routes) for the
  routes the Veryfront SDK uses.
