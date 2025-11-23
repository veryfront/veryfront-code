# Authentication Example

This example demonstrates a complete authentication system with Veryfront,
including:

- User registration and login
- Session management
- Protected routes
- JWT token authentication
- Password hashing
- Remember me functionality

## Features

- ✅ Sign up with email/password
- ✅ Login with credentials
- ✅ JWT-based authentication
- ✅ Protected API routes
- ✅ Client-side route protection
- ✅ Session persistence
- ✅ Logout functionality

## Running the Example

```bash
cd examples/auth-app
deno task dev
```

## Project Structure

```
auth-app/
├── app/
│   ├── layout.tsx          # Root layout with auth provider
│   ├── page.tsx            # Home page
│   ├── login/
│   │   └── page.tsx        # Login page
│   ├── signup/
│   │   └── page.tsx        # Signup page
│   ├── dashboard/
│   │   ├── layout.tsx      # Protected layout
│   │   └── page.tsx        # Protected dashboard
│   └── api/
│       ├── auth/
│       │   ├── login/route.ts
│       │   ├── signup/route.ts
│       │   └── logout/route.ts
│       └── user/route.ts   # Protected API route
├── lib/
│   ├── auth.ts             # Auth utilities
│   ├── jwt.ts              # JWT helpers
│   └── db.ts               # Mock database
├── components/
│   ├── AuthProvider.tsx
│   └── ProtectedRoute.tsx
└── middleware.ts           # Auth middleware
```

## Key Implementation Details

### JWT Token Management

- Tokens are signed with a secret key
- Tokens expire after 7 days
- Refresh tokens can be implemented for extended sessions

### Password Security

- Passwords are hashed using bcrypt
- Salt rounds: 10
- Never store plain text passwords

### Protected Routes

- Client-side: UseAuth hook checks authentication
- Server-side: Middleware validates JWT tokens
- API routes return 401 for unauthorized access

## Extending This Example

- Add OAuth providers (Google, GitHub)
- Implement password reset flow
- Add two-factor authentication
- Add user profile management
- Implement role-based access control
