/**
 * App template - Configuration
 */

import type { TemplateFile } from "../blog.ts";

export const appConfigTemplates: TemplateFile[] = [
  {
    path: "veryfront.config.js",
    content: `export default {
  title: "My App",
  description: "A full-stack app built with Veryfront",

  // App configuration
  app: {
    name: "My App",
    api: {
      prefix: "/api",
      cors: true,
    },
  },

  // Security
  security: {
    csp: true,
    cors: {
      origin: ["http://localhost:3002"],
      credentials: true,
    },
  },

  // Theme
  theme: {
    colors: {
      primary: "#6366F1",
      secondary: "#EC4899",
      success: "#10B981",
      danger: "#EF4444",
    },
  },

  // Development
  dev: {
    port: 3002,
    open: true,
  },

  // Middleware
  middleware: [
    "auth",
    "logging",
    "rate-limit",
  ],

  // Import map
  resolve: {
    importMap: {
      imports: {
        "react": "https://esm.sh/react@19.1.1",
        "react/jsx-runtime": "https://esm.sh/react@19.1.1/jsx-runtime",
        "react-dom": "https://esm.sh/react-dom@19.1.1",
        "react-dom/client": "https://esm.sh/react-dom@19.1.1/client",
        "zod": "https://esm.sh/zod@3.22.0",
        "nanoid": "https://esm.sh/nanoid@5.0.0",
      },
    },
  },

  // Cache configuration
  cache: {
    dir: ".veryfront/cache",
    render: {
      // Choose between "memory", "filesystem", "kv", or "redis"
      type: getEnv("REDIS_URL") ? "redis" : "memory",
      ttl: 5 * 60 * 1000,
      maxEntries: 500,
      redisUrl: getEnv("REDIS_URL") ?? undefined,
      redisKeyPrefix: "vf:render:",
    },
  },
};`,
  },
  {
    path: ".env.example",
    content: `# Environment variables
DATABASE_URL=postgresql://user:password@localhost:5432/myapp
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key-here

# OAuth providers
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Email service
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=`,
  },
];
