/**
 * Client-side authentication template for app template
 * Provides browser-side authentication utilities
 * @module cli/templates/app/lib/auth-client-template
 */

import type { TemplateFile } from "./types.ts";

/**
 * Creates the client-side authentication library template file
 *
 * This template provides:
 * - Login functionality with API integration
 * - Logout with redirect
 * - User registration
 * - Error handling for authentication operations
 *
 * @returns Template file for lib/auth-client.ts
 */
export function createAuthClientTemplate(): TemplateFile {
  return {
    path: "lib/auth-client.ts",
    content: `export async function login(email: string, password: string) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw toError(createError({
      type: "config",
      message: error.error || "Login failed"
    }));
  }

  return response.json();
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/";
}

export async function register(data: {
  email: string;
  password: string;
  name: string;
}) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw toError(createError({
      type: "config",
      message: error.error || "Registration failed"
    }));
  }

  return response.json();
}`,
  };
}
