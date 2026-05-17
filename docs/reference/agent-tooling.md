---
title: "Agent tooling and runtime state"
description: "Remote tool allowlists, provider-native tool discovery, and request-aware runtime hooks for agents."
order: 14
---

# Agent tooling and runtime state

Use these `veryfront/agent` surfaces when a host needs to shape the tool and
model runtime per request without forking the agent execution loop.

This page covers remote tool allowlists, provider-native tool inventory,
request-aware model transport, step-boundary runtime refresh, runtime
instruction helpers, and response-like guards.

## Remote tool allowlists

Use `allowedRemoteTools` when a host discovers a remote tool inventory but only
wants a subset exposed to the model and executable at runtime. Omit it to expose
all tools returned by `remoteTools`. Use an empty array to expose none.

```ts
import { agent } from "veryfront/agent";
import { createRemoteMCPToolSource } from "veryfront/tool";

const docsTools = createRemoteMCPToolSource({
  id: "docs-mcp",
  endpoint: "https://docs.example.com/mcp",
  headers: { Authorization: "Bearer <TOKEN>" },
});

const assistant = agent({
  system: "Use only the selected remote tools.",
  remoteTools: [docsTools],
  allowedRemoteTools: ["docs_search"],
});
```

## Provider-native tool inventory

Use these helpers when a host needs to derive provider-native remote-tool
allowlists for forked or runtime-isolated executions without hardcoding
provider/tool mappings outside the package.

```ts
import { expandAllowedRemoteToolNames, getProviderNativeToolNames } from "veryfront/agent";

const providerNativeToolNames = getProviderNativeToolNames({
  model: "anthropic/claude-sonnet-4-6",
});

const allowedRemoteToolNames = expandAllowedRemoteToolNames({
  model: "anthropic/claude-sonnet-4-6",
  toolNames: ["create_file"],
});
```

| Export                                  | Use                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `getProviderNativeToolNames(options)`   | Return the provider-native tool ids currently available for the provider/model.                     |
| `expandAllowedRemoteToolNames(options)` | Expand a remote-tool allowlist with package-owned provider-native tool ids for that provider/model. |

## Request-aware model transport

Use `resolveModelTransport` to inject request-scoped provider transport
behavior, request headers, and provider options without forking the runtime
loop.

```ts
import { agent } from "veryfront/agent";

const assistant = agent({
  model: "openai/gpt-5.4-mini",
  system: "You are a helpful assistant.",
  resolveModelTransport: async ({ context, resolvedModel }) => ({
    headers: {
      Authorization: "Bearer <TOKEN>",
      "x-veryfront-model": resolvedModel,
    },
    providerOptions: {
      gateway: {
        projectSlug: context?.projectSlug,
      },
    },
  }),
});
```

## Step-boundary runtime refresh

Use `resolveRuntimeState` when long-lived runs need to react to changing
steering, selected project, or host-owned runtime context. The hook runs before
each model step with the current system string, accumulated messages, and
host-owned runtime context.

```ts
import { agent } from "veryfront/agent";

const assistant = agent({
  system: "You are a helpful assistant.",
  resolveRuntimeState: async ({ step, messages, context, system }) => {
    if (step === 0) {
      return undefined;
    }

    const switchedProject = messages.some((message) =>
      message.role === "tool" &&
      message.parts.some((part) =>
        part.type === "tool-result" &&
        part.toolName === "switch_project"
      )
    );

    if (!switchedProject) {
      return { system, context };
    }

    return {
      system: `${system}\n\nActive project: project-b`,
      context: { ...context, projectId: "project-b" },
    };
  },
});
```

## Runtime instruction helpers

Use these helpers when a host needs to add the current tool surface to runtime
system instructions without copying prompt bookkeeping.

| Export                        | Use                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `withRuntimeToolInventory()`  | Append the canonical current-run tool inventory system message, replacing any previous inventory message. |
| `flattenSystemInstructions()` | Flatten system messages into the string form consumed by model runtimes.                                  |

## Response-like guards

Use `isResponseLike()` when host hooks can return a `Response` created by a
different JavaScript runtime realm. It avoids fragile `instanceof Response`
checks at route boundaries.

```ts
import { isResponseLike } from "veryfront/agent";

const result = await beforeParse(request);
if (isResponseLike(result)) {
  return result;
}
```
