# Form Handling Example

This example demonstrates how to handle form submissions in Veryfront using the App Router and API routes.

## Features

- Client-side form handling
- POST request to API route
- Server-side validation simulation
- Error and success states

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
form-handling/
├── app/
│   ├── page.tsx            # Form page component
│   └── api/
│       └── submit/route.ts # Form submission API endpoint
├── veryfront.config.ts     # Veryfront configuration
├── package.json            # npm dependencies
└── deno.json               # Deno configuration
```

## How It Works

1. The form component renders a contact form with name, email, and message fields
2. On submit, it sends a POST request to `/api/submit`
3. The API route validates the data and returns success/error responses
4. The form displays appropriate feedback to the user
