import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div>
      <nav className="flex items-center gap-4 mb-8 pb-4 border-b border-neutral-200 dark:border-neutral-700">
        <a
          href="/"
          className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
        >
          Home
        </a>
        <a
          href="/static"
          className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
        >
          Static Page
        </a>
        <a
          href="/docs/getting-started"
          className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
        >
          Documentation
        </a>
      </nav>

      <div>{children}</div>

      <aside className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 text-sm text-blue-600 dark:text-blue-400">
        This content is from the root layout (pages/layout.tsx)
      </aside>
    </div>
  );
}
