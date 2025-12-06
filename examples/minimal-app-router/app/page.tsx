export default function Home() {
  return (
    <div className="text-center py-16">
      <h1 className="text-4xl font-bold text-neutral-900 dark:text-white mb-4">
        Minimal App Router
      </h1>
      <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-md mx-auto mb-8">
        A minimal example demonstrating the App Router pattern with nested routes and layouts.
      </p>
      <div className="flex gap-3 justify-center">
        <a
          href="/docs"
          className="px-6 py-3 bg-blue-500 text-white rounded-full font-medium hover:bg-blue-600 transition-colors"
        >
          View Docs
        </a>
        <a
          href="/api/echo"
          className="px-6 py-3 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white rounded-full font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
        >
          Test API
        </a>
      </div>
    </div>
  );
}
