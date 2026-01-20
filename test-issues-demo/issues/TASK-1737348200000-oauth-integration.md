---
id: TASK-1737348200000-oauth-integration
type: task
title: Add OAuth provider integration
status: in_progress
priority: high
milestone: PLAN-1737348000000-example
assignee: bob
created: '2026-01-20T06:03:20.000Z'
updated: '2026-01-20T06:03:20.000Z'
---

# Add OAuth provider integration

## Description

Integrate OAuth 2.0 authentication with Google, GitHub, and Microsoft providers.

## Providers

### Google
- Client ID: `xxx.apps.googleusercontent.com`
- Scopes: `openid profile email`

### GitHub
- Client ID: From OAuth app settings
- Scopes: `read:user user:email`

### Microsoft
- Client ID: From Azure portal
- Scopes: `openid profile email`

## Acceptance Criteria

- [ ] Create OAuth client configuration
- [ ] Implement authorization URL generation
- [ ] Handle OAuth callbacks
- [ ] Exchange authorization code for tokens
- [ ] Fetch user profile from each provider
- [ ] Normalize user data to common format
- [ ] Add tests for each provider

## API

```typescript
interface OAuthProvider {
  name: 'google' | 'github' | 'microsoft'
  getAuthUrl(state: string): string
  handleCallback(code: string): Promise<UserProfile>
}
```

## Related

Part of: PLAN-1737348000000-example (Authentication System Spec)
Blocks: TASK-1737348100000-jwt-signing (needs user data for JWT payload)
