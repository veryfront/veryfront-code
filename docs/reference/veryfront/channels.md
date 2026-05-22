---
title: "veryfront/channels"
description: "Channel transports for the Veryfront control plane and AG-UI invoke route. These are deep-import-only modules."
order: 30
---

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
| `CONTROL_PLANE_AGENTS_LIST_PATH` | Shared control plane agents list path value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L11) |
| `CONTROL_PLANE_RUN_STREAM_PATH` | Shared control plane run stream path value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L15) |
| `CONTROL_PLANE_RUNS_PATH_PREFIX` | Shared control plane runs path prefix value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L13) |
| `ControlPlaneAgentsListRequestSchema` | Zod schema for control plane agents list request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L42) |
| `ControlPlaneSurfaceSchema` | Zod schema for control plane surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L31) |
| `RuntimeAgentListResponseSchema` | Zod schema for runtime agent list response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L112) |
| `RuntimeAgentSchema` | Zod schema for runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L103) |
| `RuntimeAgentSkillSchema` | Zod schema for runtime agent skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L57) |
| `RuntimeSuggestionSchema` | Zod schema for runtime suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L78) |
| `RuntimeSuggestionsSchema` | Zod schema for runtime suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L88) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `listRuntimeAgents` | List runtime agents. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L354) |
| `verifyControlPlaneJws` | Verify control plane JWS. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L455) |
| `verifyDispatchJws` | Verify dispatch JWS. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L422) |
| `verifyDispatchJwsSignature` | Verify the Ed25519 signature of a dispatch JWS and the recency of its timestamps, without binding to a particular request body or audience. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L386) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ControlPlaneAgentsListRequest` | Request payload for control plane agents list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L147) |
| `ControlPlaneClaims` | Public API contract for control plane claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L169) |
| `ControlPlaneSurface` | Public API contract for control plane surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L145) |
| `DispatchClaims` | Public API contract for dispatch claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L167) |
| `RuntimeAgent` | Public API contract for runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L161) |
| `RuntimeAgentDiscoveryDeps` | Public API contract for runtime agent discovery deps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L172) |
| `RuntimeAgentListResponse` | Response payload for runtime agent list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L163) |
| `RuntimeAgentSkill` | Public API contract for runtime agent skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L151) |
| `RuntimeSuggestion` | Public API contract for runtime suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L153) |
| `RuntimeSuggestions` | Public API contract for runtime suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L157) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getControlPlaneAgentsListRequestSchema` | Zod schema for get control plane agents list request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L34) |
| `getControlPlaneSurfaceSchema` | Zod schema for get control plane surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L27) |
| `getRuntimeAgentListResponseSchema` | Zod schema for get runtime agent list response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L106) |
| `getRuntimeAgentSchema` | Zod schema for get runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L91) |
| `getRuntimeAgentSkillSchema` | Zod schema for get runtime agent skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L47) |
| `getRuntimeSuggestionSchema` | Zod schema for get runtime suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L60) |
| `getRuntimeSuggestionsSchema` | Zod schema for get runtime suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L81) |

### `veryfront/channels/invoke`

```ts
import { buildChannelResponseParts, executeChannelInvoke, listChannelAssistants } from "veryfront/channels/invoke";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `ChannelAssistantSchema` | Zod schema for channel assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L90) |
| `ChannelAssistantsRequestSchema` | Zod schema for channel assistants request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L78) |
| `ChannelAssistantsResponseSchema` | Zod schema for channel assistants response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L99) |
| `ChannelInvokeRequestSchema` | Zod schema for channel invoke request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L67) |
| `ChannelInvokeResponseSchema` | Zod schema for channel invoke response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L177) |
| `ChannelResponsePartSchema` | Zod schema for channel response part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L158) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildChannelResponseParts` | Builds channel response parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L334) |
| `executeChannelInvoke` | Execute channel invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L400) |
| `listChannelAssistants` | List channel assistants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L205) |
| `normalizeConversationHistoryForRuntime` | Normalizes conversation history for runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L259) |
| `resolveChannelInvokeAgent` | Resolves channel invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L274) |
| `verifyDispatchJws` | Verify dispatch JWS. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L422) |
| `verifyDispatchJwsSignature` | Verify the Ed25519 signature of a dispatch JWS and the recency of its timestamps, without binding to a particular request body or audience. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L386) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChannelAssistantsRequest` | Request payload for channel assistants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L184) |
| `ChannelAssistantsResponse` | Response payload for channel assistants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L188) |
| `ChannelInvokeDeps` | Public API contract for channel invoke deps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L195) |
| `ChannelInvokeRequest` | Request payload for channel invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L180) |
| `ChannelInvokeResponse` | Response payload for channel invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L182) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `defaultChannelInvokeDeps` | Shared default channel invoke deps value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L198) |
| `getChannelAssistantSchema` | Zod schema for get channel assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L81) |
| `getChannelAssistantsRequestSchema` | Zod schema for get channel assistants request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L70) |
| `getChannelAssistantsResponseSchema` | Zod schema for get channel assistants response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L93) |
| `getChannelInvokeRequestSchema` | Zod schema for get channel invoke request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L65) |
| `getChannelInvokeResponseSchema` | Zod schema for get channel invoke response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L161) |
| `getChannelResponsePartSchema` | Zod schema for get channel response part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L148) |

## Related

Architecture:

- [06-ag-ui-transport](../../architecture/06-ag-ui-transport.md): AG-UI transport
- [11-control-plane-channels](../../architecture/11-control-plane-channels.md): Control-plane channels
