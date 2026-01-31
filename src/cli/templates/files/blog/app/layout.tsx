import type { ReactNode } from "react";

export const metadata = {
  title: "My Blog",
  description: "A blog built with Veryfront",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps): ReactNode {
  const linkClassName =
    "text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors";

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-900">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-lg border-b border-neutral-200 dark:border-neutral-800">
        <nav className="max-w-2xl mx-auto px-6">
          <div className="flex justify-between h-14 items-center">
            <a href="/" className="text-lg font-semibold text-neutral-900 dark:text-white">
              My Blog
            </a>
            <div className="flex gap-6">
              <a href="/" className={linkClassName}>
                Home
              </a>
              <a href="/about" className={linkClassName}>
                About
              </a>
              <a href="/archive" className={linkClassName}>
                Archive
              </a>
            </div>
          </div>
        </nav>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">{children}</main>

      <footer className="border-t border-neutral-200 dark:border-neutral-800 mt-16">
        <div className="max-w-2xl mx-auto px-6 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
          Built with Veryfront
        </div>
      </footer>
    </div>
  );
}
