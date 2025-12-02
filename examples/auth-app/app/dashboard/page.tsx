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
    return <div>Loading...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <div>
      <div
        style={{
          backgroundColor: "white",
          padding: "2rem",
          borderRadius: "8px",
          marginBottom: "2rem",
        }}
      >
        <h1>Dashboard</h1>
        <p>Welcome back, {user.email}!</p>
      </div>

      <div
        style={{
          backgroundColor: "white",
          padding: "2rem",
          borderRadius: "8px",
        }}
      >
        <h2>User Information</h2>
        <dl>
          <dt style={{ fontWeight: "bold", marginTop: "1rem" }}>Email</dt>
          <dd>{user.email}</dd>

          <dt style={{ fontWeight: "bold", marginTop: "1rem" }}>User ID</dt>
          <dd>{user.id}</dd>

          <dt style={{ fontWeight: "bold", marginTop: "1rem" }}>
            Member Since
          </dt>
          <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
        </dl>

        <button
          type="button"
          onClick={handleLogout}
          style={{
            marginTop: "2rem",
            padding: "0.75rem 2rem",
            backgroundColor: "#dc3545",
            color: "white",
            border: "none",
            borderRadius: "4px",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
}
