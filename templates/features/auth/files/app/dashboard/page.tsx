"use client";

import { useEffect, useState } from "react";

interface User {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

export default function DashboardPage(): React.JSX.Element | null {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    void checkAuth();
  }, []);

  async function checkAuth(): Promise<void> {
    try {
      const response = await fetch("/api/auth/me");
      if (!response.ok) {
        globalThis.location.href = "/login";
        return;
      }

      const { user: fetchedUser }: { user?: User } = await response.json();
      if (!fetchedUser) {
        globalThis.location.href = "/login";
        return;
      }

      setUser(fetchedUser);
    } catch (error) {
      console.error("Auth check failed:", error);
      globalThis.location.href = "/login";
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
    globalThis.location.href = "/";
  }

  if (loading) {
    return (
      <div className="text-center py-8 text-neutral-500 dark:text-neutral-400">Loading...</div>
    );
  }

  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Dashboard</h1>
        <p className="text-neutral-600 dark:text-neutral-400 mt-1">Welcome back, {user.name}</p>
      </div>

      <div className="bg-white dark:bg-neutral-800 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-700">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">
          Account Information
        </h2>

        <dl className="space-y-4">
          <div>
            <dt className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Name</dt>
            <dd className="text-neutral-900 dark:text-white mt-1">{user.name}</dd>
          </div>

          <div>
            <dt className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Email</dt>
            <dd className="text-neutral-900 dark:text-white mt-1">{user.email}</dd>
          </div>

          <div>
            <dt className="text-sm font-medium text-neutral-500 dark:text-neutral-400">User ID</dt>
            <dd className="text-neutral-900 dark:text-white mt-1 font-mono text-sm">{user.id}</dd>
          </div>

          <div>
            <dt className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
              Member Since
            </dt>
            <dd className="text-neutral-900 dark:text-white mt-1">
              {new Date(user.createdAt).toLocaleDateString()}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-8 px-6 py-2.5 bg-red-500 text-white font-medium rounded-xl hover:bg-red-600 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
