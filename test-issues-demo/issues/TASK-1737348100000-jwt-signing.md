---
id: TASK-1737348100000-jwt-signing
type: task
title: Implement JWT signing and verification
status: todo
priority: high
milestone: PLAN-1737348000000-example
assignee: alice
created: '2026-01-20T06:01:40.000Z'
updated: '2026-01-20T06:01:40.000Z'
---

# Implement JWT signing and verification

## Description

Create a token service that handles JWT signing and verification using RS256 asymmetric encryption.

## Acceptance Criteria

- [ ] Generate RSA key pair (2048 bits minimum)
- [ ] Implement `signToken(payload)` function
- [ ] Implement `verifyToken(token)` function
- [ ] Handle token expiration (15 min for access tokens)
- [ ] Add token claims (sub, iat, exp, iss)
- [ ] Unit tests with >95% coverage

## Implementation Notes

Use `jose` library for JWT operations:

```typescript
import { SignJWT, jwtVerify } from 'jose'

async function signToken(payload: Record<string, any>) {
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer('veryfront-auth')
    .sign(privateKey)
  return jwt
}
```

## Related

Part of: PLAN-1737348000000-example (Authentication System Spec)
