export default function HomePage() {
  return (
    <div>
      <h1 className="text-4xl font-bold text-neutral-900 dark:text-white mb-4">
        Welcome to Veryfront
      </h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-8">
        Edit <code className="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm">app/page.tsx</code> to get started.
      </p>
      <div className="flex gap-3">
        <a
          href="/about"
          className="px-4 py-2 bg-blue-500 text-white rounded-full text-sm font-medium hover:bg-blue-600 transition-colors"
        >
          About
        </a>
        <a
          href="https://veryfront.com/docs"
          className="px-4 py-2 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white rounded-full text-sm font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
        >
          Documentation
        </a>
      </div>
    </div>
  );
}
