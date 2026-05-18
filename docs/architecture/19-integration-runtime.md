# Integration runtime

This page describes the connector catalog, integration metadata schemas, and
remote integration tool loading and execution. It does not cover OAuth route
handlers or local tool definitions.

## Responsibility

Integration code exposes connector metadata, icons, schema-backed integration
configuration, and per-request remote tools fetched from the configured API
layer.

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
  schema --> config[Project integration config]
  config --> sync[Config sync to API]

  request[Agent request context] --> token[Resolve project or request token]
  token --> list[Fetch remote tool definitions]
  list --> inventory[Merge into agent tool inventory]
  inventory --> call[Model calls integration tool]
  call --> execute[Execute via integrations tools API]
  execute --> result[Structured tool result or sanitized error]
```

1. Connector metadata defines supported providers, auth requirements, tools,
   prompts, icons, and environment requirements.
2. Schema helpers validate integration config and connector metadata.
3. Remote tool helpers resolve request-scoped or environment API credentials.
4. Tool definitions are fetched per request so enabled integrations remain
   project-scoped.
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
- Keep per-project tool visibility scoped to the active request or environment
  token.
- Update [Integrations](../guides/integrations.md) when catalog behavior or
  public config changes.

## Related guides

- [Integrations](../guides/integrations.md)

## Related reference

- [`veryfront/integrations`](../reference/veryfront/integrations.md)
