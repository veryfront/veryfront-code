/**
 * Authentication template for app template
 * Provides session management and authentication utilities
 * @module cli/templates/app/lib/auth-template
 */

import type { TemplateFile } from "./types.ts";

/**
 * Creates the authentication library template file
 *
 * This template provides:
 * - Session creation and validation
 * - Token-based authentication
 * - Session expiration handling
 * - In-memory session storage (to be replaced with database)
 *
 * @returns Template file for lib/auth.ts
 */
export function createAuthTemplate(): TemplateFile {
  return {
    path: "lib/auth.ts",
    content: `import { nanoid } from "nanoid";

interface User {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
}

interface Session {
  token: string;
  userId: string;
  expiresAt: Date;
}

// In-memory storage (replace with database)
const sessions = new Map<string, Session>();
const ONE_DAY_MS = 86_400_000;

export async function createSession(user: User): Promise<Session> {
  const token = nanoid();
  const session: Session = {
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + ONE_DAY_MS), // 24 hours
  };

  sessions.set(token, session);
  return session;
}

export async function verifySession(token: string): Promise<Session | null> {
  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt < new Date()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

export async function getSession(): Promise<{ user: User } | null> {
  // This is a placeholder - in real app, get from cookies
  return null;
}

export async function deleteSession(token: string): Promise<void> {
  sessions.delete(token);
}`,
  };
}
