'use client';

import * as React from "react";
import { useAuth } from "./AuthProvider.tsx";

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
}