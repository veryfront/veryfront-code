'use client';

import { useAuth } from './AuthProvider.tsx';

export function Header(): JSX.Element {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-lg border-b border-neutral-200 dark:border-neutral-800">
      <nav className="max-w-5xl mx-auto px-6">
        <div className="flex justify-between h-14 items-center">
          <a href="/" className="text-lg font-semibold text-neutral-900 dark:text-white">
            My App
          </a>

          <div className="flex items-center gap-6">
            {user ? (
              <>
                <a
                  href="/dashboard"
                  className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
                >
                  Dashboard
                </a>
                <span className="text-sm text-neutral-500">{user.name}</span>
                <button
                  type="button"
                  onClick={logout}
                  className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <a
                  href="/login"
                  className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
                >
                  Sign in
                </a>
                <a
                  href="/register"
                  className="text-sm px-4 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors"
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
