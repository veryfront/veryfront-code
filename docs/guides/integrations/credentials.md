---
title: "Integration credentials and scopes"
description: "Separate platform login from provider authorization, set up each credential type, and choose connection scopes."
order: 55
---

An integration call combines credentials that come from different owners. Use
this guide to decide which credential a task needs, how to set up a connector
that does not use OAuth consent, and which scope a connection belongs to.

## Platform login and provider authorization

Signing in to Veryfront and authorizing a provider are separate steps. Neither
one performs the other.

| Step                   | Proves                                   | How                                                                                             |
| ---------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Platform login         | Who you are in Veryfront                 | `veryfront login`, a Veryfront API key in `VERYFRONT_API_TOKEN`, or a Studio session            |
| Provider authorization | Which provider account Veryfront may use | OAuth consent through `veryfront integration connect`, a `connectUrl`, or Studio's connect card |
| Project credentials    | Which provider key a project uses        | Project environment variables named by the connector catalog                                    |

`veryfront integration connect` requires an existing platform login and never
starts one. Signing in to Veryfront with Google does not connect Gmail; the
Gmail connection is a separate consent with its own scopes, even for the same
Google account. A Veryfront API token never reaches the provider, and a provider
token never authenticates you to Veryfront.

## Credentials versus grants

Four independent controls decide whether a call runs. No integration policy
setup is required.

1. **Platform credential:** A Veryfront API key or login token. It identifies the
   caller and is limited by its own scopes.
2. **Project access:** The caller's role in the project. Reading status and
   calling read-only tools needs viewer access. Starting a personal connection
   needs viewer access and a credential allowed to write integrations; starting
   a shared project connection needs editor access.
3. **Provider credential:** An OAuth connection in inventory, or project
   credentials in environment variables. It decides which provider account the
   call uses and what that account can do.
4. **Capability grant:** For agents, the tool list in agent source, optionally
   narrowed by `integrations.allow` in source configuration. It decides which
   tools an agent can call. It never selects a credential.

A connection is not a grant: connecting Gmail does not add Gmail tools to an
agent, and adding a tool does not create a connection. The selected account and
its `connection_generation_id` describe a connection; they do not authorize a
later call on their own.

## Set up each credential type

The connector catalog tells you which setup a connector needs. Read
`credential_requirement` from `GET /integrations/<NAME>`,
`veryfront integration get <NAME> --json`, or `client.getIntegration("<NAME>")`:

- `mode: "oauth_connection"`: connect an account through OAuth consent.
- `mode: "project_credentials"`: set the variables in `mandatory_env_vars` as
  project environment variables in the matching Veryfront environment.

`veryfront integration connect` returns `setup_required` with the same catalog
details for a project-credentials connector instead of opening a browser.

| Credential type             | Catalog `auth.type`                      | Setup                                                                     | Hosted execution              | Local execution                       |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- | ----------------------------- | ------------------------------------- |
| OAuth consent, managed app  | `oauth2` with `authorization_url`        | Connect an account. No project variables.                                 | Yes, per connection           | No                                    |
| OAuth consent, your own app | `oauth2` with `authorization_url`        | Set the variables named in `byo_oauth_app_override`, then connect.        | Yes, per connection           | No                                    |
| API key                     | `api-key`                                | Set the key variables, for example `STRIPE_SECRET_KEY`.                   | Yes, project credentials only | Yes, when the key is sent in a header |
| Basic authentication        | `basic`                                  | Set the user and secret variables, for example `TWILIO_AUTH_TOKEN`.       | Yes, project credentials only | Yes                                   |
| OAuth client credentials    | `oauth2` with `token_url` only           | Set the client ID and secret variables, for example `PERSONIO_CLIENT_ID`. | Yes, project credentials only | Yes                                   |
| Salesforce service account  | See [Set up Salesforce](./salesforce.md) | Set the three `SALESFORCE_SERVICE_ACCOUNT_*` variables.                   | Yes                           | Yes                                   |

Keep provider secrets in your approved secret manager and in project environment
variables. Never place them in agent prompts, tool arguments, project files,
logs, or URLs.

### Hosted execution limits

- Project credentials belong to the project, not to a user. A call cannot select
  them with `connection_id`; the API rejects that combination with
  `validation-failed`.
- A call to a project-credentials connector whose variables are missing returns
  `isError: true` with `structuredContent.error` set to `missing_credentials`
  and the missing variable names in `missingEnvVars`. No provider request is
  sent.
- The hosted catalog lists every connector the API can run. The framework's
  local catalog hides feature-gated connectors unless
  `VERYFRONT_EXPERIMENTAL_INTEGRATIONS` names them.

### Local execution limits

`createLocalIntegrationToolSource` runs connectors in your own process with
credentials from the host environment or a `credentialProvider`. The host must
set `VERYFRONT_HOST_ALLOW_LOCAL_INTEGRATION_CREDENTIALS=1`. It supports fixed
HTTPS REST endpoints with header API keys, Basic authentication, OAuth client
credentials, and the Salesforce service account. It rejects authorization-code
OAuth, query-string credentials, GraphQL connectors, and tools outside the exact
grant. Use hosted execution for any connector that needs OAuth consent. See
[Run account-free local integration tools](../integrations.md#run-account-free-local-integration-tools).

## Connection scope

| Scope     | Owner                       | Who can use it                            | Create it with                                                  |
| --------- | --------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `user`    | One user inside one project | That user's calls and runs in the project | `veryfront integration connect <NAME>` (default scope)          |
| `project` | The project                 | Shared with the project and its resources | `veryfront integration connect <NAME> --scope project` (editor) |

The default scope is always `user`; Veryfront never creates a shared connection
unless you ask for `project`. The legacy value `endUser` is accepted on input as
`user`, and responses always use `user`.

## Selection and schema reference

| Surface    | Project                                                     | Connection selector         | Generation precondition                         | Tool input schema                         |
| ---------- | ----------------------------------------------------------- | --------------------------- | ----------------------------------------------- | ----------------------------------------- |
| REST       | `x-veryfront-project-slug` header or `/projects/<ref>` path | `connection_id` in the body | `expected_connection_generation_id` in the body | `GET /integrations/<NAME>/tools`          |
| GraphQL    | `projectReference`                                          | `connectionId`              | `expectedConnectionGenerationId`                | Not exposed; use REST, MCP, or TypeScript |
| MCP        | `/projects/<PROJECT_SLUG>/mcp`                              | `_meta.connection_id`       | `_meta.expected_connection_generation_id`       | `tools/list` `inputSchema`                |
| TypeScript | `projectReference` in `createIntegrationClient`             | `connectionId` option       | `expectedConnectionGenerationId` option         | `client.listTools("<NAME>")`              |
| CLI        | `--project`                                                 | `--connection`              | `--expected-generation`                         | `veryfront integration tools <NAME>`      |

Tool arguments are provider input and are never read as selectors. REST also
accepts `x-veryfront-expected-project-id`, which rejects a request when the slug
resolves to a different project UUID. The TypeScript client sends it for you.

Connection rows from `GET /projects/<ref>/integrations/<NAME>/connections`,
`client.listConnections`, and `veryfront integration connections` contain:

| Field                      | Meaning                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `id`                       | Stable connection identifier to select.                                   |
| `integration`              | Connector name.                                                           |
| `scope`                    | `user` or `project`.                                                      |
| `status`                   | `connected`, `expired`, or `disconnected`. Only `connected` rows can run. |
| `connection_generation_id` | Changes on every reconnect. Pin it to refuse a replaced account.          |

## Verify it worked

1. `veryfront integration get <NAME> --json` reports the
   `credential_requirement.mode` you set up for.
2. For an OAuth connector, `veryfront integration connections <NAME>` lists a
   `connected` row in the scope you chose.
3. For a project-credentials connector, a read-only call no longer returns
   `missing_credentials`.

## Related

- [Integrations](../integrations.md): make a first call on each surface.
- [Recover integration connections](./recovery.md): denied consent, expiry,
  revocation, and changed generations.
- [OAuth](../oauth.md): custom OAuth app overrides.
