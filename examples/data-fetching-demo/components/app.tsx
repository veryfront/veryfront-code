import type { ReactNode } from "react";

interface AppProps {
  children: ReactNode;
}

export default function App({ children }: AppProps) {
  return (
    <html lang="en">
      <head>
        <title>Data Fetching Demo</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body className="min-h-screen bg-white dark:bg-neutral-900">
        <nav className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-lg border-b border-neutral-200 dark:border-neutral-800">
          <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
            <span className="text-lg font-semibold text-neutral-900 dark:text-white">
              Data Fetching Demo
            </span>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              SSR and SSG with ISR
            </p>
          </div>
        </nav>

        <main className="max-w-3xl mx-auto px-6 py-12">{children}</main>

        <footer className="border-t border-neutral-200 dark:border-neutral-800 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
          <p>Built with Veryfront - A modern React framework</p>
        </footer>
      </body>
    </html>
  );
}
