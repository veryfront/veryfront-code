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

- User registration with email/password
- Login with credentials
- JWT-based authentication
- Protected API routes
- Client-side route protection
- Session persistence
- Logout functionality

## Setup

1. Install dependencies:

```bash
npm install
# or
deno install
```

2. Run the dev server:

```bash
npm run dev
# or
deno task dev
```

3. Visit http://localhost:3002

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
│   └── AuthProvider.tsx
├── veryfront.config.ts     # Auth middleware configuration
└── package.json            # Project dependencies
```

## Key Implementation Details

### JWT Token Management

- Tokens are signed with a secret key using Web Crypto API
- Tokens expire after 7 days
- Refresh tokens can be implemented for extended sessions

### Password Security

- Passwords are hashed before storage
- Never store plain text passwords

### Protected Routes

- Client-side: UseAuth hook checks authentication
- Server-side: Middleware validates JWT tokens
- API routes return 401 for unauthorized access

## Environment Variables

Create a `.env` file with:

```env
JWT_SECRET=your-secret-key-change-in-production
```

## Extending This Example

- Add OAuth providers (Google, GitHub)
- Implement password reset flow
- Add two-factor authentication
- Add user profile management
- Implement role-based access control
