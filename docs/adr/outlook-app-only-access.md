# Outlook runs app-only outside Veryfront Cloud

Status: accepted 2026-10-18 (veryfront/veryfront-issue-inbox#3522)

## Context

The catalog `outlook` connector uses delegated OAuth through the Veryfront Cloud consent flow. A
self-hosted runtime cannot use that flow, so the local catalog source rejects it with
"unsupported authorization-code credentials". Unattended work, such as reading an intake mailbox
on a schedule, needs Outlook access with no signed-in user and no Veryfront Cloud dependency.

## Options

1. Delegated access only, through the scaffolded Outlook OAuth template with the project's own
   Entra app. Each action runs as a signed-in user, and someone must sign in again when the
   refresh token expires or is revoked.
2. App-only access only, through Microsoft Entra client credentials. No user signs in, but an
   unrestricted application permission covers every mailbox in the tenant.
3. Support both modes and prefer app-only access for project-owned automation.

## Decision

Option 3. App-only access is the preferred mode. `createOutlookServiceAccountToolSource` provides
it with these rules:

- One configured mailbox. Every Graph request targets `/users/<OUTLOOK_SERVICE_ACCOUNT_MAILBOX>`,
  never `/me`. Tools that let the caller choose a mailbox, and delegated-only operations, are
  rejected.
- Least privilege. Application `Mail.Read` covers reading. `Mail.ReadWrite` is added only for
  moves and other mail changes, and write tools also need `allowWrites: true`. An administrator
  grants consent. A mailbox-scoped access policy (Exchange Online RBAC for Applications or an
  application access policy) is recommended.
- In-memory tokens. The source mints a token with the client secret, keeps it in process memory
  until shortly before it expires, and mints a new one after that. It stores no refresh token and
  writes nothing to disk.
- The client secret lives in the project environment as `OUTLOOK_SERVICE_ACCOUNT_CLIENT_SECRET`,
  next to the client ID, tenant ID and mailbox, using the same names as Veryfront Cloud.

Delegated access stays available through the scaffolded Outlook OAuth template for actions that
must run as an individual user.

## Consequences

- A tenant administrator must register an app and grant consent before the source works.
- Without a mailbox-scoped access policy, the application permission reaches every mailbox in the
  tenant. The source pins one mailbox, but the policy is the boundary Microsoft enforces.
- Rotating the secret means updating it in Entra and in the project environment. The next call
  mints a new token because the cached token is keyed to the credential values.
- Live qualification against a real tenant is a separate gate and is not covered by fixture tests.
