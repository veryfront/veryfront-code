# SaaS Starter

A production-ready app with authentication, conversation memory, and a full UI.

## What's included

- Landing page with feature highlights
- OAuth login (Google and GitHub)
- Dashboard with conversation sidebar
- Per-user conversation memory persisted across sessions

## Structure

```
agents/assistant.ts        Agent with conversation memory
tools/search.ts            Placeholder domain search
app/
  api/ag-ui/route.ts        AG-UI endpoint
  page.tsx                 Landing page
  login/page.tsx           OAuth login
  dashboard/page.tsx       Chat with sidebar
```

This starter is not production-ready.
