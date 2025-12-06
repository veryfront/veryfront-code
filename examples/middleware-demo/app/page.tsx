export default function HomePage() {
  return (
    <html lang="en">
      <head>
        <title>Middleware Demo</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body className="min-h-screen bg-white dark:bg-neutral-900">
        <nav className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-lg border-b border-neutral-200 dark:border-neutral-800">
          <div className="max-w-2xl mx-auto px-6 h-14 flex items-center">
            <span className="text-lg font-semibold text-neutral-900 dark:text-white">
              Middleware Demo
            </span>
          </div>
        </nav>
        <main className="max-w-2xl mx-auto px-6 py-12">
          <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-4">
            Middleware Demo
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400 mb-8">
            This page is public. Check the server console for request logs.
          </p>
          <div className="bg-neutral-50 dark:bg-neutral-800 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-700">
            <p className="text-neutral-700 dark:text-neutral-300">
              Try accessing{" "}
              <a
                href="/protected"
                className="text-blue-500 hover:text-blue-600 font-medium"
              >
                /protected
              </a>{" "}
              (will fail without token)
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
