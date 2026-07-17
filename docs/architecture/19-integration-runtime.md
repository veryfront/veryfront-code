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

  request[Agent request context] --> inventory[Agent tool inventory]
  inventory --> token[Resolve project or request token]
  token --> list[Fetch remote tool definitions]
  list --> call[Model calls configured integration tool]
  call --> execute[Execute via integrations tools API]
  execute --> result[Structured tool result or sanitized error]
```

1. Connector metadata defines supported providers, auth requirements, tools,
   prompts, icons, and environment requirements.
2. Schema helpers validate connector metadata.
3. Remote tool helpers resolve request-scoped or environment API credentials.
4. Tool definitions are fetched per request for the active agent tool inventory.
5. Tool execution is delegated to the configured API layer and normalized for
   the agent runtime.

## Boundaries

- Integration runtime owns connector metadata and remote tool bridge behavior.
- OAuth runtime owns provider redirects, callbacks, and token storage.
- Local project tools belong in [agent runtime](./05-agent-runtime.md) and the
  public [Tools](../guides/tools.md) guide.
- The backing API owns actual third-party API calls and provider token access.

## Change checks

- Add schema tests when changing connector, auth, endpoint, tool, or prompt
  metadata.
- Add remote-tool tests when changing request-scoped token resolution, tool
  listing, call payloads, or result normalization.
- Keep tool visibility scoped to the active agent and request credentials.
- Update [Integrations](../guides/integrations.md) when catalog behavior or
  public runtime behavior changes.

## Related guides

- [Integrations](../guides/integrations.md)

## Related reference

- [`veryfront/integrations`](../api-reference/veryfront/integrations.md)
