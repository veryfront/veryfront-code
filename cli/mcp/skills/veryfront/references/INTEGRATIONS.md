# Integrations

Call provider tools such as `gmail__list_emails` through a connected account.
Full guide: https://veryfront.com/docs/code/guides/integrations

## Two separate logins

- **Platform login** (`veryfront login`, `VERYFRONT_API_TOKEN`) authenticates
  you to Veryfront. It never connects a provider.
- **Provider consent** (`veryfront integration connect "<NAME>" --project "<PROJECT_SLUG>"`) authorizes one
  provider account for one project. It needs a person in a browser and an
  existing platform credential: a login session or `VERYFRONT_API_TOKEN`.

Never ask for, print, or store provider passwords, OAuth tokens, API keys, or
the Veryfront token in prompts, tool arguments, files, or logs.

## Procedure

Always pass the project explicitly. Never let Veryfront or yourself pick a
different project or account. This procedure is for OAuth connectors
(`credential_requirement.mode` is `oauth_connection` in
`veryfront integration get "<NAME>" --project "<PROJECT_SLUG>" --json`). For
project-credentials connectors, see [Non-OAuth connectors](#non-oauth-connectors).

```bash
veryfront integration tools gmail --project "<PROJECT_SLUG>" --json
veryfront integration connections gmail --project "<PROJECT_SLUG>" --json
veryfront integration status gmail --project "<PROJECT_SLUG>" \
  --tool gmail__list_emails --connection "<CONNECTION_ID>" \
  --expected-generation "<CONNECTION_GENERATION_ID>" --json
veryfront integration call gmail__list_emails --project "<PROJECT_SLUG>" \
  --connection "<CONNECTION_ID>" --expected-generation "<CONNECTION_GENERATION_ID>" \
  --args '{"q":"in:inbox","maxResults":1}' --json
```

1. Discover the tool and its input schema with `integration tools`.
2. Read `integration connections`. Use a row with `status: "connected"`. If
   several rows qualify, ask the person which account to use.
3. Check readiness with `integration status --tool`. Continue only when
   `local_eligibility.state` is `eligible`.
4. Call once with `--connection` and `--expected-generation` from that row.

When no connection exists, ask the person to run
`veryfront integration connect gmail --project "<PROJECT_SLUG>"` (add
`--scope project` only for a shared connection). The command waits at most
`--timeout` seconds and confirms the new row. Do not poll in a loop yourself.

Other surfaces call the same tools:

- REST: `POST /integrations/<name>/tools/<tool>/call` with `arguments`,
  `connection_id`, and `expected_connection_generation_id`.
- GraphQL: the `executeIntegrationTool` mutation with `projectReference`,
  `toolName`, `connectionId`, `expectedConnectionGenerationId`, and `args`.
- MCP: `https://api.veryfront.com/projects/<PROJECT_SLUG>/mcp`, `tools/call`
  with the canonical tool name, `_meta.connection_id`, and
  `_meta.expected_connection_generation_id`. The unscoped `/mcp`
  endpoint cannot call integration tools.
- TypeScript: `createIntegrationClient` from `veryfront/integrations`.

## Recovery

| Signal                                           | Provider effect | Do this                                                                      |
| ------------------------------------------------ | --------------- | ---------------------------------------------------------------------------- |
| `authentication_required`                        | None            | Ask the person to connect, then call once.                                   |
| `reconnect_required`                             | None            | Ask the person to reconnect the same account in the same scope.              |
| `integration-consent-denied`                     | None            | Stop. Ask whether they want to connect.                                      |
| `integration-connect-unconfirmed` or expired URL | None            | Inspect `integration connections`, then start a new connect if needed.       |
| `Selected connection generation changed`         | None            | Re-read inventory, confirm the same `id`, call once with the new generation. |
| `execution_outcome_unknown` or `outcomeUnknown`  | Unknown         | Never repeat a write. Ask the person to check the provider.                  |

Retry only after a failure that says no provider request ran. Never switch to a
different account to make a call succeed.

## Non-OAuth connectors

`veryfront integration connect "<NAME>" --project "<PROJECT_SLUG>"` returns `setup_required` for connectors
with `credential_requirement.mode: "project_credentials"`. The person sets the
variables in `mandatory_env_vars` as project environment variables. Do not
accept those values in chat. Call these tools with `--project` only: they have no connection
inventory, and the API rejects `--connection` for them.
