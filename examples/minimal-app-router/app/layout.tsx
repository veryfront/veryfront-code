export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <title>Minimal App Router</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body className="min-h-screen bg-white dark:bg-neutral-900">
        <nav className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-lg border-b border-neutral-200 dark:border-neutral-800">
          <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
            <a
              href="/"
              className="text-lg font-semibold text-neutral-900 dark:text-white"
            >
              Minimal App Router
            </a>
            <div className="flex items-center gap-6">
              <a
                href="/"
                className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
              >
                Home
              </a>
              <a
                href="/docs"
                className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
              >
                Docs
              </a>
            </div>
          </div>
        </nav>
        <main className="max-w-4xl mx-auto px-6 py-12">{children}</main>
      </body>
    </html>
  );
}
