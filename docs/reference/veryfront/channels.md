---
title: "veryfront/channels"
description: "Channel transports for the Veryfront control plane and AG-UI invoke route. These are deep-import-only modules."
order: 29
---

# veryfront/channels

Channel transports for the Veryfront control plane and AG-UI invoke route. These are deep-import-only modules.

`veryfront/channels` has no direct exports. Use the deep imports below.

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/channels/control-plane`

```ts
import { listRuntimeAgents, verifyControlPlaneJws, verifyDispatchJws } from "veryfront/channels/control-plane";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `CONTROL_PLANE_AGENTS_LIST_PATH` | Shared control plane agents list path value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L10) |
| `CONTROL_PLANE_RUN_STREAM_PATH` | Shared control plane run stream path value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L14) |
| `CONTROL_PLANE_RUNS_PATH_PREFIX` | Shared control plane runs path prefix value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L12) |
| `ControlPlaneAgentsListRequestSchema` | Zod schema for control plane agents list request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L41) |
| `ControlPlaneSurfaceSchema` | Zod schema for control plane surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L30) |
| `RuntimeAgentListResponseSchema` | Zod schema for runtime agent list response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L111) |
| `RuntimeAgentSchema` | Zod schema for runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L102) |
| `RuntimeAgentSkillSchema` | Zod schema for runtime agent skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L56) |
| `RuntimeSuggestionSchema` | Zod schema for runtime suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L77) |
| `RuntimeSuggestionsSchema` | Zod schema for runtime suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L87) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `listRuntimeAgents` | List runtime agents. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L353) |
| `verifyControlPlaneJws` | Verify control plane JWS. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L454) |
| `verifyDispatchJws` | Verify dispatch JWS. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L421) |
| `verifyDispatchJwsSignature` | Verify the Ed25519 signature of a dispatch JWS and the recency of its timestamps, without binding to a particular request body or audience. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L385) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ControlPlaneAgentsListRequest` | Request payload for control plane agents list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L146) |
| `ControlPlaneClaims` | Public API contract for control plane claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L168) |
| `ControlPlaneSurface` | Public API contract for control plane surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L144) |
| `DispatchClaims` | Public API contract for dispatch claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L166) |
| `RuntimeAgent` | Public API contract for runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L160) |
| `RuntimeAgentDiscoveryDeps` | Public API contract for runtime agent discovery deps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L171) |
| `RuntimeAgentListResponse` | Response payload for runtime agent list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L162) |
| `RuntimeAgentSkill` | Public API contract for runtime agent skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L150) |
| `RuntimeSuggestion` | Public API contract for runtime suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L152) |
| `RuntimeSuggestions` | Public API contract for runtime suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L156) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getControlPlaneAgentsListRequestSchema` | Zod schema for get control plane agents list request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L33) |
| `getControlPlaneSurfaceSchema` | Zod schema for get control plane surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L26) |
| `getRuntimeAgentListResponseSchema` | Zod schema for get runtime agent list response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L105) |
| `getRuntimeAgentSchema` | Zod schema for get runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L90) |
| `getRuntimeAgentSkillSchema` | Zod schema for get runtime agent skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L46) |
| `getRuntimeSuggestionSchema` | Zod schema for get runtime suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L59) |
| `getRuntimeSuggestionsSchema` | Zod schema for get runtime suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L80) |

### `veryfront/channels/invoke`

```ts
import { buildChannelResponseParts, executeChannelInvoke, listChannelAssistants } from "veryfront/channels/invoke";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `ChannelAssistantSchema` | Zod schema for channel assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L89) |
| `ChannelAssistantsRequestSchema` | Zod schema for channel assistants request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L77) |
| `ChannelAssistantsResponseSchema` | Zod schema for channel assistants response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L98) |
| `ChannelInvokeRequestSchema` | Zod schema for channel invoke request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L66) |
| `ChannelInvokeResponseSchema` | Zod schema for channel invoke response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L176) |
| `ChannelResponsePartSchema` | Zod schema for channel response part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L157) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildChannelResponseParts` | Builds channel response parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L333) |
| `executeChannelInvoke` | Execute channel invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L399) |
| `listChannelAssistants` | List channel assistants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L204) |
| `normalizeConversationHistoryForRuntime` | Normalizes conversation history for runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L258) |
| `resolveChannelInvokeAgent` | Resolves channel invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L273) |
| `verifyDispatchJws` | Verify dispatch JWS. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L421) |
| `verifyDispatchJwsSignature` | Verify the Ed25519 signature of a dispatch JWS and the recency of its timestamps, without binding to a particular request body or audience. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L385) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChannelAssistantsRequest` | Request payload for channel assistants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L183) |
| `ChannelAssistantsResponse` | Response payload for channel assistants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L187) |
| `ChannelInvokeDeps` | Public API contract for channel invoke deps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L194) |
| `ChannelInvokeRequest` | Request payload for channel invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L179) |
| `ChannelInvokeResponse` | Response payload for channel invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L181) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `defaultChannelInvokeDeps` | Shared default channel invoke deps value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L197) |
| `getChannelAssistantSchema` | Zod schema for get channel assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L80) |
| `getChannelAssistantsRequestSchema` | Zod schema for get channel assistants request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L69) |
| `getChannelAssistantsResponseSchema` | Zod schema for get channel assistants response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L92) |
| `getChannelInvokeRequestSchema` | Zod schema for get channel invoke request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L64) |
| `getChannelInvokeResponseSchema` | Zod schema for get channel invoke response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L160) |
| `getChannelResponsePartSchema` | Zod schema for get channel response part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L147) |

## Related

Architecture:

- [06-ag-ui-transport](../../architecture/06-ag-ui-transport.md): AG-UI transport
- [11-control-plane-channels](../../architecture/11-control-plane-channels.md): Control-plane channels
