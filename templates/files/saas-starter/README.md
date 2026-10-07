# SaaS Starter

A SaaS-shaped starter with an unauthenticated dashboard preview, conversation memory, and a full UI.

## What's included

- Landing page with feature highlights
- Explicit dashboard preview screen
- Dashboard with conversation sidebar
- Browser-persisted conversation memory

## Structure

```
agents/assistant.ts        Agent with conversation memory
tools/search.ts            Placeholder domain search
app/
  api/ag-ui/route.ts        AG-UI endpoint
  page.tsx                 Landing page
  login/page.tsx           Dashboard preview screen
  dashboard/page.tsx       Chat with sidebar
```

## Authentication

The login page is an unauthenticated preview so the starter works immediately. It links directly to
`/dashboard`. It does not create a user session, verify provider tokens, or protect routes.

Use Veryfront's built-in OIDC scaffold before protecting real users or private data:

```bash
veryfront generate auth oidc
```

Merge the generated `security.auth.oidc` example into your Veryfront config, copy the generated
`.env.auth.example` values into your deployment environment, and register the exact deployed
`/_veryfront/auth/callback` URL with your identity provider as documented in the generated
`AUTH_SETUP.md`. Your app can route users through `/_veryfront/auth/login` and
`/_veryfront/auth/logout`; those are application endpoints, not additional IdP redirect URIs.

This starter is not production-ready until authentication, authorization, rate limits, and
deployment settings are wired for your app.
