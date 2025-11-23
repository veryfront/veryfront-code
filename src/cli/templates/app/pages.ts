/**
 * App template - Page components
 */

import type { TemplateFile } from "../blog.ts";

export const appPageTemplates: TemplateFile[] = [
  {
    path: "app/layout.tsx",
    content: `import * as React from "react";
import { AuthProvider } from "../components/AuthProvider";
import { Toaster } from "../components/Toaster";

export const metadata = {
  title: "My App",
  description: "A full-stack app built with Veryfront",
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css"
        />
      </head>
      <body className="bg-gray-50 text-gray-900">
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}`,
  },
  {
    path: "app/page.tsx",
    content: `import { Header } from "../components/Header";
import { HeroSection } from "../components/HeroSection";
import { FeatureGrid } from "../components/FeatureGrid";

export default function HomePage() {
  return (
    <>
      <Header />
      <main>
        <HeroSection />
        <FeatureGrid />
      </main>
    </>
  );
}`,
  },
  {
    path: "app/dashboard/page.tsx",
    content: `import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { DashboardLayout } from "../../components/DashboardLayout";
import { StatsGrid } from "../../components/StatsGrid";
import { RecentActivity } from "../../components/RecentActivity";

export default async function DashboardPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-gray-600 mt-2">
            Welcome back, {session.user.name}!
          </p>
        </div>

        <StatsGrid userId={session.user.id} />
        <RecentActivity userId={session.user.id} />
      </div>
    </DashboardLayout>
  );
}`,
  },
  {
    path: "app/login/page.tsx",
    content: `'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "../../lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError("Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-center">Sign in to your account</h2>
          <p className="mt-2 text-center text-gray-600">
            Or{" "}
            <a href="/register" className="text-indigo-600 hover:text-indigo-500">
              create a new account
            </a>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-800 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}`,
  },
];
