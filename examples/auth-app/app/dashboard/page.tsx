"use client";

import { useEffect, useState } from "react";

interface User {
  id: string;
  email: string;
  createdAt: string;
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const response = await fetch("/api/auth/me");
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        globalThis.location.href = "/login";
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      globalThis.location.href = "/login";
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    globalThis.location.href = "/";
  }

  if (loading) {
    return <div className="text-center py-8 text-neutral-500 dark:text-neutral-400">Loading...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Dashboard</h1>
        <p className="text-neutral-600 dark:text-neutral-400 mt-1">Welcome back, {user.email}</p>
      </div>

      <div className="bg-white dark:bg-neutral-800 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-700">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">Account Information</h2>

        <dl className="space-y-4">
          <div>
            <dt className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Email</dt>
            <dd className="text-neutral-900 dark:text-white mt-1">{user.email}</dd>
          </div>

          <div>
            <dt className="text-sm font-medium text-neutral-500 dark:text-neutral-400">User ID</dt>
            <dd className="text-neutral-900 dark:text-white mt-1 font-mono text-sm">{user.id}</dd>
          </div>

          <div>
            <dt className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Member Since</dt>
            <dd className="text-neutral-900 dark:text-white mt-1">{new Date(user.createdAt).toLocaleDateString()}</dd>
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
