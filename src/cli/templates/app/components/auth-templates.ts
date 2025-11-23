/**
 * App Components Templates - Authentication Components
 *
 * @module cli/templates/app/components/auth-templates
 */

import type { TemplateFile } from "./types.ts";

/**
 * Authentication-related component templates (Header and AuthProvider)
 */
export const authComponentTemplates: TemplateFile[] = [
  {
    path: "components/Header.tsx",
    content: `'use client';

import * as React from "react";
import { useAuth } from "./AuthProvider";

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="bg-white shadow-sm">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <a href="/" className="text-xl font-bold text-indigo-600">
              My App
            </a>
          </div>

          <div className="flex items-center space-x-4">
            {user ? (
              <>
                <a
                  href="/dashboard"
                  className="text-gray-700 hover:text-gray-900"
                >
                  Dashboard
                </a>
                <span className="text-gray-500">|</span>
                <span className="text-gray-700">{user.name}</span>
                <button
                  onClick={logout}
                  className="text-gray-700 hover:text-gray-900"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <a
                  href="/login"
                  className="text-gray-700 hover:text-gray-900"
                >
                  Sign in
                </a>
                <a
                  href="/register"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Get started
                </a>
              </>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}`,
  },
  {
    path: "components/AuthProvider.tsx",
    content: `'use client';

import React, { createContext, useContext, useState, useEffect } from "react";
import { logout as logoutUser } from "../lib/auth-client";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is logged in
    fetch("/api/auth/me")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.user) setUser(data.user);
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = () => {
    logoutUser();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);`,
  },
];
