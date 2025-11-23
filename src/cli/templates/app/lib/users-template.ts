/**
 * Users management template for app template
 * Provides user CRUD operations and password validation
 * @module cli/templates/app/lib/users-template
 */

import type { TemplateFile } from "./types.ts";

/**
 * Creates the users management library template file
 *
 * This template provides:
 * - User creation with password hashing
 * - Password validation using bcrypt
 * - User retrieval operations
 * - In-memory user storage (to be replaced with database)
 * - Demo user for testing
 *
 * @returns Template file for lib/users.ts
 */
export function createUsersTemplate(): TemplateFile {
  return {
    path: "lib/users.ts",
    content: `import { nanoid } from "nanoid";
import { hash, compare } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

interface User {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  passwordHash: string;
  createdAt: Date;
}

// In-memory storage (replace with database)
const users = new Map<string, User>();

// Demo user
const demoUser: User = {
  id: "demo-user",
  email: "demo@example.com",
  name: "Demo User",
  role: "user",
  passwordHash: await hash("password"),
  createdAt: new Date(),
};
users.set(demoUser.id, demoUser);

export async function createUser(data: {
  email: string;
  name: string;
  password: string;
  role?: "user" | "admin";
}): Promise<Omit<User, "passwordHash">> {
  const user: User = {
    id: nanoid(),
    email: data.email,
    name: data.name,
    role: data.role || "user",
    passwordHash: await hash(data.password),
    createdAt: new Date(),
  };

  users.set(user.id, user);

  const { passwordHash, ...publicUser } = user;
  return publicUser;
}

export async function validatePassword(
  email: string,
  password: string
): Promise<Omit<User, "passwordHash"> | null> {
  const user = Array.from(users.values()).find(u => u.email === email);
  if (!user) return null;

  const valid = await compare(password, user.passwordHash);
  if (!valid) return null;

  const { passwordHash, ...publicUser } = user;
  return publicUser;
}

export async function getUsers(): Promise<Array<Omit<User, "passwordHash">>> {
  return Array.from(users.values()).map(({ passwordHash, ...user }) => user);
}

export async function getUser(id: string): Promise<Omit<User, "passwordHash"> | null> {
  const user = users.get(id);
  if (!user) return null;

  const { passwordHash, ...publicUser } = user;
  return publicUser;
}`,
  };
}
