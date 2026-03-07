# Security Module

## Purpose

The security module provides core security primitives and policies for Veryfront applications, including CSP (Content Security Policy), CORS, authentication utilities, and input validation.

## Scope

### What this module does:

- Content Security Policy (CSP) configuration and enforcement
- CORS (Cross-Origin Resource Sharing) policies
- Authentication helpers and session management
- Input validation and sanitization
- Security headers management
- XSS/CSRF protection utilities

### What this module does NOT do:

- HTTP-level security enforcement (see `security/http/`)
- Middleware execution (see `middleware/builtin/security/`)
- Runtime sandboxing (see `runtime/security/`)

## Architecture

```
security/
├── http/                   # HTTP security
│   ├── auth.ts            # Authentication utilities
│   ├── config.ts          # Security configuration
│   ├── cors.ts            # CORS policies
│   └── csp.ts             # Content Security Policy
└── input-validation/      # Input sanitization
    ├── validators.ts      # Validation rules
    └── sanitizers.ts      # Input cleaning
```

## Key Exports

### CSP (Content Security Policy)

- `createCSPPolicy(options)` - Generate CSP header
- `CSPBuilder` - Fluent CSP builder
- `defaultCSP` - Secure default policy

### CORS

- `createCORSPolicy(options)` - CORS configuration
- `isAllowedOrigin(origin, policy)` - Origin validation
- `CORSPreflightHandler` - Handle OPTIONS requests

### Authentication

- `validateAuthToken(token)` - JWT/session validation
- `hashPassword(password)` - Secure password hashing
- `comparePasswords(plain, hashed)` - Password verification

### Input Validation

- `validateInput(value, rules)` - Multi-rule validation
- `sanitizeHTML(html)` - XSS protection
- `escapeSQL(query)` - SQL injection protection

## Dependencies

### Internal

- `shared/` - Utilities and constants
- `server/` - HTTP integration

### External

- `bcrypt` (optional) - Password hashing
- `jsonwebtoken` (optional) - JWT handling

## Usage Examples

### Content Security Policy

```typescript
import { CSPBuilder } from "./security/http";

const csp = new CSPBuilder()
  .defaultSrc(["self"])
  .scriptSrc(["self", "https://cdn.example.com"])
  .styleSrc(["self", "unsafe-inline"])
  .imgSrc(["self", "data:", "https:"])
  .build();

// Apply to response
response.headers.set("Content-Security-Policy", csp);
```

### CORS Configuration

```typescript
import { createCORSPolicy } from "./security/http";

const cors = createCORSPolicy({
  origin: ["https://app.example.com", "https://admin.example.com"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
  maxAge: 86400, // 24 hours
});

// Check origin
if (cors.isAllowed(request.headers.get("origin"))) {
  // Add CORS headers
}
```

### Authentication

```typescript
import { hashPassword, validateAuthToken } from "./security/http";

// Hash password
const hashedPassword = await hashPassword("user-password");

// Validate token
const payload = await validateAuthToken(token, {
  secret: process.env.JWT_SECRET,
  algorithms: ["HS256"],
});

console.log(payload.userId);
```

### Input Validation

```typescript
import { sanitizeHTML, validateInput } from "./security/input-validation";

// Validate email
const emailResult = validateInput(userInput.email, {
  type: "email",
  required: true,
  maxLength: 255,
});

if (!emailResult.valid) {
  throw new Error(emailResult.errors.join(", "));
}

// Sanitize HTML content
const safeHTML = sanitizeHTML(userInput.bio, {
  allowedTags: ["p", "br", "strong", "em"],
  allowedAttributes: {},
});
```

## Security Best Practices

### 1. CSP Configuration

```typescript
// Production CSP - Strict
const strictCSP = new CSPBuilder()
  .defaultSrc(["none"])
  .scriptSrc(["self"])
  .styleSrc(["self"])
  .imgSrc(["self"])
  .connectSrc(["self"])
  .fontSrc(["self"])
  .objectSrc(["none"])
  .mediaSrc(["self"])
  .frameSrc(["none"])
  .build();

// Development CSP - Relaxed for HMR
const devCSP = new CSPBuilder()
  .defaultSrc(["self"])
  .scriptSrc(["self", "unsafe-eval"]) // For HMR
  .connectSrc(["self", "ws:", "wss:"]) // For WebSocket
  .build();
```

### 2. CORS Policies

```typescript
// Public API - Open CORS
const publicCORS = createCORSPolicy({
  origin: "*",
  methods: ["GET"],
  credentials: false,
});

// Private API - Restricted CORS
const privateCORS = createCORSPolicy({
  origin: (origin) => {
    return origin?.endsWith(".example.com") ?? false;
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
  exposedHeaders: ["X-Request-ID"],
});
```

### 3. Password Security

```typescript
import { comparePasswords, hashPassword } from "./security/http";

// Registration
const user = {
  email: input.email,
  passwordHash: await hashPassword(input.password, {
    rounds: 12, // bcrypt cost factor
  }),
};

// Login
const valid = await comparePasswords(
  input.password,
  user.passwordHash,
);
```

### 4. Input Validation

```typescript
// Define validation schema
const userSchema = {
  email: {
    type: "email",
    required: true,
    maxLength: 255,
  },
  age: {
    type: "number",
    min: 18,
    max: 120,
  },
  bio: {
    type: "string",
    maxLength: 1000,
    sanitize: true,
  },
};

// Validate and sanitize
const result = validateInput(userInput, userSchema);
if (!result.valid) {
  return new Response(JSON.stringify({ errors: result.errors }), {
    status: 400,
  });
}
```

## Security Headers

### Recommended Headers

```typescript
const securityHeaders = {
  "Content-Security-Policy": csp,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};
```

## Testing

```bash
# Run security tests
deno task test src/security/

# Test CSP generation
deno task test src/security/http/csp.test.ts

# Test input validation
deno task test src/security/input-validation/
```

## Maintainer

**Team:** Security Team
**Primary Contact:** security@example.com
**Code Owners:** See CODEOWNERS file

## Related Modules

- [`server/`](../server/README.md) - Request handlers with security enforcement
- [`middleware/`](../middleware/README.md) - Security middleware

## Common Vulnerabilities

### XSS (Cross-Site Scripting)

**Prevention:**

- Use `sanitizeHTML()` for user content
- Set strict CSP
- Escape output in templates

### CSRF (Cross-Site Request Forgery)

**Prevention:**

- Use SameSite cookies
- Validate CORS origin
- Implement CSRF tokens

### SQL Injection

**Prevention:**

- Use parameterized queries
- Never concatenate user input
- Use `escapeSQL()` as last resort

### Authentication Issues

**Prevention:**

- Use secure password hashing (bcrypt, cost ≥12)
- Implement rate limiting
- Use HTTPS only
- Set secure session cookies

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CSP Reference](https://content-security-policy.com/)
- [CORS Specification](https://fetch.spec.whatwg.org/#http-cors-protocol)
- [Veryfront Security Guide](https://veryfront.com/docs/security)
