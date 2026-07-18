# Integration runtime

This page describes the connector catalog, integration metadata schemas, and
remote integration tool loading and execution. It does not cover OAuth route
handlers or local tool definitions.

## Responsibility

Integration code exposes connector metadata, icons, and per-request remote tools
fetched from the configured API layer.

Primary source areas:

- [`src/integrations/`](../../src/integrations/)
- [`src/integrations/index.ts`](../../src/integrations/index.ts)
- [`src/integrations/schema.ts`](../../src/integrations/schema.ts)
- [`src/integrations/_data.ts`](../../src/integrations/_data.ts)
- [`src/integrations/remote-tools.ts`](../../src/integrations/remote-tools.ts)
- [`src/integrations/types.ts`](../../src/integrations/types.ts)

## Runtime flow

```mermaid
flowchart TD
  catalog[Connector catalog] --> schema[Integration schemas]
  source[Agent source tool list] --> capabilities[Resolve agent capabilities]
  sourcePolicy[Optional exact-source allowlist] --> narrowing[Intersect capability policies]
  projectPolicy[Optional control-plane project policy] --> narrowing
  connections[Connection inventory] --> readiness[Select a ready project or user credential]

  request[Agent request context] --> list[Fetch remote tool definitions]
  list --> capabilities
  capabilities --> call[Model requests integration tool]
  call --> execute[Authorize and execute requested tool]
  narrowing --> execute
  readiness --> execute
  execute --> api[Integrations tools API]
  api --> result[Structured tool result or sanitized error]
```

1. Connector metadata defines supported providers, auth requirements, tools,
   prompts, icons, and environment requirements.
2. Schema helpers validate connector metadata.
3. Agent source declares which integration tools belong to the agent.
4. Optional `veryfront.config.ts` policy narrows integrations and tools for the
   exact branch, release, or environment without enabling capabilities.
5. Optional project policy adds control-plane narrowing without redefining
   agent capabilities.
6. Connection inventory remains control-plane data and determines credential
   readiness independently of agent source and both policy layers.
7. Remote tool helpers resolve request-scoped or environment API credentials.
8. Tool definitions are fetched per request so source-declared integration
   requests remain project-scoped.
9. Tool execution is delegated to the configured API layer and normalized for
   the agent runtime.

## Boundaries

- Integration runtime owns connector metadata and remote tool bridge behavior.
- Agent source owns the agent's integration tool declaration.
- Exact-source `veryfront.config.ts` owns an optional monotonic allowlist. Its
  absence is unrestricted; it never enables an integration or grants credentials.
- The control plane owns optional project policy and connection inventory.
- OAuth runtime owns provider redirects, callbacks, and token storage.
- Local project tools belong in [agent runtime](./05-agent-runtime.md) and the
  public [Tools](../guides/tools.md) guide.
- The backing API owns actual third-party API calls and provider token access.

Effective integration capability is the intersection of agent selection,
connector catalog, source configuration, and control-plane policy. No policy
layer can add a capability removed by another layer.

The framework normalizes source configuration once at the project request
boundary and carries it in request-local runtime context. Direct agents, AG-UI
handlers, and in-process delegates consume the same effective restriction.
Only an actual process boundary serializes the manifest for a hosted or durable
child; handler-local tool-list rewriting is not an authorization boundary.

## Change checks

- Add schema tests when changing connector, auth, endpoint, tool, or prompt
  metadata.
- Add remote-tool tests when changing request-scoped token resolution, tool
  listing, call payloads, or result normalization.
- Keep per-project tool visibility scoped to the active request or environment
  token.
- Keep config caches qualified by the exact branch, release, or environment;
  never reuse one source target's integration policy for another.
- Update [Integrations](../guides/integrations.md) when catalog, policy, or
  connection behavior changes.

## Related guides

- [Integrations](../guides/integrations.md)

## Related reference

- [`veryfront/integrations`](../api-reference/veryfront/integrations.md)
