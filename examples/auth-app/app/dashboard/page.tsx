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
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <div>
      <div className="bg-white p-8 rounded-lg mb-8">
        <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
        <p className="text-gray-600">Welcome back, {user.email}!</p>
      </div>

      <div className="bg-white p-8 rounded-lg">
        <h2 className="text-2xl font-semibold mb-4">User Information</h2>
        <dl>
          <dt className="font-bold mt-4 text-gray-700">Email</dt>
          <dd className="text-gray-600">{user.email}</dd>

          <dt className="font-bold mt-4 text-gray-700">User ID</dt>
          <dd className="text-gray-600">{user.id}</dd>

          <dt className="font-bold mt-4 text-gray-700">Member Since</dt>
          <dd className="text-gray-600">{new Date(user.createdAt).toLocaleDateString()}</dd>
        </dl>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-8 px-8 py-3 bg-red-500 text-white rounded font-bold hover:bg-red-600 transition-colors"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
