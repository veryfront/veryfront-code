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
| `CONTROL_PLANE_AGENTS_LIST_PATH` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L9) |
| `CONTROL_PLANE_RUN_STREAM_PATH` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L11) |
| `CONTROL_PLANE_RUNS_PATH_PREFIX` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L10) |
| `ControlPlaneAgentsListRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L34) |
| `ControlPlaneSurfaceSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L25) |
| `RuntimeAgentListResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L94) |
| `RuntimeAgentSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L87) |
| `RuntimeAgentSkillSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L47) |
| `RuntimeSuggestionSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L66) |
| `RuntimeSuggestionsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L74) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `listRuntimeAgents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L323) |
| `verifyControlPlaneJws` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L422) |
| `verifyDispatchJws` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L390) |
| `verifyDispatchJwsSignature` | Verify the Ed25519 signature of a dispatch JWS and the recency of its timestamps, without binding to a particular request body or audience. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L355) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ControlPlaneAgentsListRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L125) |
| `ControlPlaneClaims` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L140) |
| `ControlPlaneSurface` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L124) |
| `DispatchClaims` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L139) |
| `RuntimeAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L135) |
| `RuntimeAgentDiscoveryDeps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L142) |
| `RuntimeAgentListResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L136) |
| `RuntimeAgentSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L128) |
| `RuntimeSuggestion` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L129) |
| `RuntimeSuggestions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L132) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getControlPlaneAgentsListRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L27) |
| `getControlPlaneClaimsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L110) |
| `getControlPlaneSurfaceSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L22) |
| `getDispatchClaimsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L96) |
| `getRuntimeAgentListResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L89) |
| `getRuntimeAgentSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L76) |
| `getRuntimeAgentSkillSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L38) |
| `getRuntimeSuggestionSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L49) |
| `getRuntimeSuggestionsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L68) |

### `veryfront/channels/invoke`

```ts
import { buildChannelResponseParts, executeChannelInvoke, listChannelAssistants } from "veryfront/channels/invoke";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `ChannelAssistantSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L83) |
| `ChannelAssistantsRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L73) |
| `ChannelAssistantsResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L90) |
| `ChannelInvokeRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L64) |
| `ChannelInvokeResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L164) |
| `ChannelResponsePartSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L147) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildChannelResponseParts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L310) |
| `executeChannelInvoke` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L375) |
| `listChannelAssistants` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L184) |
| `normalizeConversationHistoryForRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L237) |
| `resolveChannelInvokeAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L251) |
| `verifyDispatchJws` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L390) |
| `verifyDispatchJwsSignature` | Verify the Ed25519 signature of a dispatch JWS and the recency of its timestamps, without binding to a particular request body or audience. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L355) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChannelAssistantsRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L168) |
| `ChannelAssistantsResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L171) |
| `ChannelInvokeDeps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L176) |
| `ChannelInvokeRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L166) |
| `ChannelInvokeResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L167) |
| `ChannelResponsePart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L175) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `defaultChannelInvokeDeps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L178) |
| `getChannelAssistantSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L75) |
| `getChannelAssistantsRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L66) |
| `getChannelAssistantsResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L85) |
| `getChannelInvokeRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L63) |
| `getChannelInvokeResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L149) |
| `getChannelResponsePartSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L138) |

## Related

Architecture:

- [06-ag-ui-transport](../../architecture/06-ag-ui-transport.md): AG-UI transport
- [11-control-plane-channels](../../architecture/11-control-plane-channels.md): Control-plane channels
