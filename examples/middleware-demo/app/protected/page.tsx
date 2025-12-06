export default function ProtectedPage() {
  return (
    <html lang="en">
      <head>
        <title>Protected - Middleware Demo</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body className="min-h-screen bg-white dark:bg-neutral-900">
        <nav className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-lg border-b border-neutral-200 dark:border-neutral-800">
          <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
            <span className="text-lg font-semibold text-neutral-900 dark:text-white">
              Middleware Demo
            </span>
            <a
              href="/"
              className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
            >
              Back to Home
            </a>
          </div>
        </nav>
        <main className="max-w-2xl mx-auto px-6 py-12">
          <div className="bg-green-50 dark:bg-green-900/20 p-6 rounded-2xl border border-green-200 dark:border-green-800">
            <h1 className="text-2xl font-bold text-green-600 dark:text-green-400 mb-2">
              Protected Content
            </h1>
            <p className="text-green-700 dark:text-green-300">
              You are seeing this because you passed the Auth Guard middleware!
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
