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

| Name | Description |
|------|-------------|
| `CONTROL_PLANE_AGENTS_LIST_PATH` |  |
| `CONTROL_PLANE_RUN_STREAM_PATH` |  |
| `CONTROL_PLANE_RUNS_PATH_PREFIX` |  |
| `ControlPlaneAgentsListRequestSchema` |  |
| `ControlPlaneSurfaceSchema` |  |
| `RuntimeAgentListResponseSchema` |  |
| `RuntimeAgentSchema` |  |
| `RuntimeAgentSkillSchema` |  |
| `RuntimeSuggestionSchema` |  |
| `RuntimeSuggestionsSchema` |  |

#### Functions

| Name | Description |
|------|-------------|
| `listRuntimeAgents` |  |
| `verifyControlPlaneJws` |  |
| `verifyDispatchJws` |  |
| `verifyDispatchJwsSignature` | Verify the Ed25519 signature of a dispatch JWS and the recency of its |

#### Types

| Name | Description |
|------|-------------|
| `ControlPlaneAgentsListRequest` |  |
| `ControlPlaneClaims` |  |
| `ControlPlaneSurface` |  |
| `DispatchClaims` |  |
| `RuntimeAgent` |  |
| `RuntimeAgentDiscoveryDeps` |  |
| `RuntimeAgentListResponse` |  |
| `RuntimeAgentSkill` |  |
| `RuntimeSuggestion` |  |
| `RuntimeSuggestions` |  |

#### Constants

| Name | Description |
|------|-------------|
| `getControlPlaneAgentsListRequestSchema` |  |
| `getControlPlaneClaimsSchema` |  |
| `getControlPlaneSurfaceSchema` |  |
| `getDispatchClaimsSchema` |  |
| `getRuntimeAgentListResponseSchema` |  |
| `getRuntimeAgentSchema` |  |
| `getRuntimeAgentSkillSchema` |  |
| `getRuntimeSuggestionSchema` |  |
| `getRuntimeSuggestionsSchema` |  |

### `veryfront/channels/invoke`

```ts
import { buildChannelResponseParts, executeChannelInvoke, listChannelAssistants } from "veryfront/channels/invoke";
```

#### Components

| Name | Description |
|------|-------------|
| `ChannelAssistantSchema` |  |
| `ChannelAssistantsRequestSchema` |  |
| `ChannelAssistantsResponseSchema` |  |
| `ChannelInvokeRequestSchema` |  |
| `ChannelInvokeResponseSchema` |  |
| `ChannelResponsePartSchema` |  |

#### Functions

| Name | Description |
|------|-------------|
| `buildChannelResponseParts` |  |
| `executeChannelInvoke` |  |
| `listChannelAssistants` |  |
| `normalizeConversationHistoryForRuntime` |  |
| `resolveChannelInvokeAgent` |  |
| `verifyDispatchJws` |  |
| `verifyDispatchJwsSignature` | Verify the Ed25519 signature of a dispatch JWS and the recency of its |

#### Types

| Name | Description |
|------|-------------|
| `ChannelAssistantsRequest` |  |
| `ChannelAssistantsResponse` |  |
| `ChannelInvokeDeps` |  |
| `ChannelInvokeRequest` |  |
| `ChannelInvokeResponse` |  |
| `ChannelResponsePart` |  |

#### Constants

| Name | Description |
|------|-------------|
| `defaultChannelInvokeDeps` |  |
| `getChannelAssistantSchema` |  |
| `getChannelAssistantsRequestSchema` |  |
| `getChannelAssistantsResponseSchema` |  |
| `getChannelInvokeRequestSchema` |  |
| `getChannelInvokeResponseSchema` |  |
| `getChannelResponsePartSchema` |  |

## Related

Architecture:

- [09-control-plane-channels](../../architecture/09-control-plane-channels.md): Control-plane channels
- [10-ag-ui-transport](../../architecture/10-ag-ui-transport.md): AG-UI transport
