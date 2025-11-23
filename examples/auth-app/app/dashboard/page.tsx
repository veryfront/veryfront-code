"use client";

import { useAuth } from "../../components/AuthProvider.tsx";
import { useEffect } from "react";

export default function DashboardPage() {
  const { user, logout, loading } = useAuth();

  useEffect(() => {
    // Redirect if not authenticated
    if (!loading && !user) {
      globalThis.location.href = "/login";
    }
  }, [user, loading]);

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
          onClick={logout}
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
