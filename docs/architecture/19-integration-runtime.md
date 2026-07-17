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
  policy[Optional control-plane project policy] --> narrowing[Apply runtime narrowing]
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
4. Optional project policy narrows runtime access without redefining agent
   capabilities.
5. Connection inventory remains control-plane data and determines credential
   readiness independently of agent source and project policy.
6. Remote tool helpers resolve request-scoped or environment API credentials.
7. Tool definitions are fetched per request so source-declared integration
   requests remain project-scoped.
8. Tool execution is delegated to the configured API layer and normalized for
   the agent runtime.

## Boundaries

- Integration runtime owns connector metadata and remote tool bridge behavior.
- Agent source owns the agent's integration tool declaration.
- The control plane owns optional project policy and connection inventory.
- OAuth runtime owns provider redirects, callbacks, and token storage.
- Local project tools belong in [agent runtime](./05-agent-runtime.md) and the
  public [Tools](../guides/tools.md) guide.
- The backing API owns actual third-party API calls and provider token access.

## Change checks

- Add schema tests when changing connector, auth, endpoint, tool, or prompt
  metadata.
- Add remote-tool tests when changing request-scoped token resolution, tool
  listing, call payloads, or result normalization.
- Keep per-project tool visibility scoped to the active request or environment
  token.
- Update [Integrations](../guides/integrations.md) when catalog, policy, or
  connection behavior changes.

## Related guides

- [Integrations](../guides/integrations.md)

## Related reference

- [`veryfront/integrations`](../api-reference/veryfront/integrations.md)
