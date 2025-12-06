import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

export default function DocsLayout({ children }: LayoutProps) {
  return (
    <div className="flex gap-8">
      <aside className="w-48 flex-shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-3">
          Documentation
        </h2>
        <nav>
          <ul className="space-y-1">
            <li>
              <a
                href="/docs/getting-started"
                className="block py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
              >
                Getting Started
              </a>
            </li>
            <li>
              <a
                href="/docs/data-fetching"
                className="block py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
              >
                Data Fetching
              </a>
            </li>
            <li className="pt-2 mt-2 border-t border-neutral-200 dark:border-neutral-700">
              <a
                href="/"
                className="block py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
              >
                Back to Home
              </a>
            </li>
          </ul>
        </nav>
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
