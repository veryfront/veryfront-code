export default function GettingStarted() {
  return (
    <article>
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-4">
        Getting Started
      </h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-8">
        Welcome to the Veryfront documentation!
      </p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">
          Installation
        </h2>
        <pre className="bg-neutral-900 dark:bg-neutral-800 text-neutral-100 p-4 rounded-xl overflow-x-auto">
          <code>npm install veryfront</code>
        </pre>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">
          Quick Start
        </h2>
        <ol className="space-y-2 text-neutral-600 dark:text-neutral-400">
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-sm flex items-center justify-center flex-shrink-0">
              1
            </span>
            Create a new project
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-sm flex items-center justify-center flex-shrink-0">
              2
            </span>
            Add your first page
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-sm flex items-center justify-center flex-shrink-0">
              3
            </span>
            Run the dev server
          </li>
        </ol>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">
          Next Steps
        </h2>
        <p className="text-neutral-600 dark:text-neutral-400">
          Check out the{" "}
          <a
            href="/docs/data-fetching"
            className="text-blue-500 hover:text-blue-600 font-medium"
          >
            Data Fetching
          </a>{" "}
          guide to learn more.
        </p>
      </section>
    </article>
  );
}
