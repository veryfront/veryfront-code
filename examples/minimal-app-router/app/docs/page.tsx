export default function Docs() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-4">
        Documentation
      </h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-8">
        Welcome to the docs section. This demonstrates nested routes in the App Router.
      </p>
      <div className="bg-neutral-50 dark:bg-neutral-800 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-700">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">
          Features
        </h2>
        <ul className="space-y-2 text-neutral-600 dark:text-neutral-400">
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
            Nested routing with layouts
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
            Loading states
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
            Error boundaries
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
            API routes
          </li>
        </ul>
      </div>
    </div>
  );
}
