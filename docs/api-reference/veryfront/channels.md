---
title: "veryfront/channels"
description: "Signed control-plane discovery and channel invocation contracts."
order: 3
---

`veryfront/channels` has no direct exports. Use the deep imports below.

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/channels/control-plane`

Signed control-plane discovery, route, and JWS verification contracts. Signature-only helpers establish authenticity and freshness; request handlers must use the body-bound verifier before authorizing an operation.

```ts
import { compareRuntimeAgentMetadata, getRuntimeAgentPublicMetadata, isConfigOptionalControlPlaneRunRequest } from "veryfront/channels/control-plane";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `ControlPlaneAgentsListRequestSchema` | Zod schema for control plane agents list request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L101) |
| `ControlPlaneSurfaceSchema` | Zod schema for control plane surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L90) |
| `RuntimeAgentListResponseSchema` | Zod schema for runtime agent list response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L172) |
| `RuntimeAgentSchema` | Zod schema for runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L163) |
| `RuntimeAgentSkillSchema` | Zod schema for runtime agent skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L116) |
| `RuntimeSuggestionSchema` | Zod schema for runtime suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L137) |
| `RuntimeSuggestionsSchema` | Zod schema for runtime suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L147) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `compareRuntimeAgentMetadata` | Compare runtime metadata by stable code-point name and id order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L226) |
| `getRuntimeAgentPublicMetadata` | Get browser-safe runtime metadata for an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L603) |
| `isConfigOptionalControlPlaneRunRequest` | True for control-plane run surfaces that can dispatch without project config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L65) |
| `listRuntimeAgents` | List runtime agents. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L647) |
| `resolveAgentSkills` | Resolve the skills visible to an agent and return stable, public metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L544) |
| `verifyControlPlaneJws` | Verify control plane JWS. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L768) |
| `verifyControlPlaneJwsSignature` | Verify the signature and freshness of a control-plane JWS without granting body, audience, project, subject, or surface authorization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L697) |
| `verifyDispatchJws` | Verify dispatch JWS. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L735) |
| `verifyDispatchJwsSignature` | Verify the Ed25519 signature of a dispatch JWS and the recency of its timestamps, without binding to a particular request body or audience. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L679) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ControlPlaneAgentsListRequest` | Request payload for control plane agents list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L177) |
| `ControlPlaneClaims` | Public API contract for control plane claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L204) |
| `ControlPlaneSurface` | Public API contract for control plane surface (literal union, not widened to `string`). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L175) |
| `DispatchClaims` | Public API contract for dispatch claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L202) |
| `RuntimeAgent` | Public API contract for runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L191) |
| `RuntimeAgentDiscoveryDeps` | Public API contract for runtime agent discovery deps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L207) |
| `RuntimeAgentListResponse` | Response payload for runtime agent list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L198) |
| `RuntimeAgentPublicMetadata` | Public API contract for browser-safe runtime agent metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L193) |
| `RuntimeAgentSkill` | Public API contract for runtime agent skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L181) |
| `RuntimeSuggestion` | Public API contract for runtime suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L183) |
| `RuntimeSuggestions` | Public API contract for runtime suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L187) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `CONTROL_PLANE_AGENTS_LIST_PATH` | Shared control plane agents list path value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L43) |
| `CONTROL_PLANE_RUN_STREAM_PATH` | Shared control plane run stream path value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L47) |
| `CONTROL_PLANE_RUNS_PATH_PREFIX` | Shared control plane runs path prefix value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L45) |
| `CONTROL_PLANE_SURFACES` | Allowed control-plane surfaces - source of truth for the schema and `ControlPlaneSurface`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L85) |
| `getControlPlaneAgentsListRequestSchema` | Zod schema for get control plane agents list request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L93) |
| `getControlPlaneSurfaceSchema` | Zod schema for get control plane surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L88) |
| `getRuntimeAgentListResponseSchema` | Zod schema for get runtime agent list response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L166) |
| `getRuntimeAgentSchema` | Zod schema for get runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L150) |
| `getRuntimeAgentSkillSchema` | Zod schema for get runtime agent skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L106) |
| `getRuntimeSuggestionSchema` | Zod schema for get runtime suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L119) |
| `getRuntimeSuggestionsSchema` | Zod schema for get runtime suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L140) |

### `veryfront/channels/invoke`

Signed channel-invocation schemas, discovery helpers, and execution adapter.

```ts
import { buildChannelResponseParts, executeChannelInvoke, listChannelAssistants } from "veryfront/channels/invoke";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `ChannelAssistantSchema` | Zod schema for channel assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L124) |
| `ChannelAssistantsRequestSchema` | Zod schema for channel assistants request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L112) |
| `ChannelAssistantsResponseSchema` | Zod schema for channel assistants response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L133) |
| `ChannelInvokeRequestSchema` | Zod schema for channel invoke request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L101) |
| `ChannelInvokeResponseSchema` | Zod schema for channel invoke response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L214) |
| `ChannelResponsePartSchema` | Zod schema for channel response part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L191) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildChannelResponseParts` | Builds channel response parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L443) |
| `executeChannelInvoke` | Execute channel invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L636) |
| `listChannelAssistants` | List channel assistants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L242) |
| `normalizeConversationHistoryForRuntime` | Normalizes conversation history for runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L311) |
| `resolveChannelInvokeAgent` | Resolves channel invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L348) |
| `verifyDispatchJws` | Verify dispatch JWS. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L735) |
| `verifyDispatchJwsSignature` | Verify the Ed25519 signature of a dispatch JWS and the recency of its timestamps, without binding to a particular request body or audience. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/control-plane.ts#L679) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChannelAssistantsRequest` | Request payload for channel assistants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L221) |
| `ChannelAssistantsResponse` | Response payload for channel assistants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L225) |
| `ChannelInvokeDeps` | Public API contract for channel invoke deps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L232) |
| `ChannelInvokeRequest` | Request payload for channel invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L217) |
| `ChannelInvokeResponse` | Response payload for channel invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L219) |
| `ExecuteChannelInvokeOptions` | Optional execution controls for a channel invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L630) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `defaultChannelInvokeDeps` | Shared default channel invoke deps value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L235) |
| `getChannelAssistantSchema` | Zod schema for get channel assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L115) |
| `getChannelAssistantsRequestSchema` | Zod schema for get channel assistants request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L104) |
| `getChannelAssistantsResponseSchema` | Zod schema for get channel assistants response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L127) |
| `getChannelInvokeRequestSchema` | Zod schema for get channel invoke request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L99) |
| `getChannelInvokeResponseSchema` | Zod schema for get channel invoke response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L194) |
| `getChannelResponsePartSchema` | Zod schema for get channel response part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/channels/invoke.ts#L181) |
