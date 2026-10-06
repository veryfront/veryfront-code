# SaaS Starter

A SaaS-shaped starter with a demo login, conversation memory, and a full UI.

## What's included

- Landing page with feature highlights
- Demo Google/GitHub sign-in screen
- Dashboard with conversation sidebar
- Browser-persisted conversation memory

## Structure

```
agents/assistant.ts        Agent with conversation memory
tools/search.ts            Placeholder domain search
app/
  api/ag-ui/route.ts        AG-UI endpoint
  page.tsx                 Landing page
  login/page.tsx           Demo sign-in screen
  dashboard/page.tsx       Chat with sidebar
```

## Authentication

The login page is a demo so the starter works immediately: both provider buttons
link directly to `/dashboard`. It does not create a user session, verify OAuth
tokens, or protect routes.

Before using this in production, add real authentication routes such as
`app/api/auth/google/route.ts` and `app/api/auth/github/route.ts`, point the
login buttons at those routes, persist an authenticated user session, and scope
conversation storage to that user.

This starter is not production-ready until authentication, authorization, rate
limits, and deployment settings are wired for your app.
