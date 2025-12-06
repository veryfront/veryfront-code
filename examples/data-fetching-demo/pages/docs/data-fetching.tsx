interface DataFetchingProps {
  serverTime: string;
}

export function getServerData() {
  return {
    props: {
      serverTime: new Date().toISOString(),
    },
  };
}

export default function DataFetching({ serverTime }: DataFetchingProps) {
  return (
    <article>
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-4">
        Data Fetching
      </h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-8">
        Learn how to fetch data in Veryfront applications.
      </p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">
          Server-Side Rendering (SSR)
        </h2>
        <p className="text-neutral-600 dark:text-neutral-400 mb-3">
          Use <code className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-sm">getServerData()</code> to fetch data on every request:
        </p>
        <pre className="bg-neutral-900 dark:bg-neutral-800 text-neutral-100 p-4 rounded-xl overflow-x-auto text-sm mb-4">
          <code>{`export function getServerData() {
  return {
    props: {
      data: fetchData()
    }
  };
}`}</code>
        </pre>
        <p className="text-neutral-600 dark:text-neutral-400">
          This page was rendered at:{" "}
          <span className="font-semibold text-neutral-900 dark:text-white">
            {serverTime}
          </span>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">
          Static Site Generation (SSG)
        </h2>
        <p className="text-neutral-600 dark:text-neutral-400 mb-3">
          Use <code className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-sm">getStaticData()</code> to pre-render pages at build time:
        </p>
        <pre className="bg-neutral-900 dark:bg-neutral-800 text-neutral-100 p-4 rounded-xl overflow-x-auto text-sm">
          <code>{`export function getStaticData() {
  return {
    props: {
      data: fetchData()
    },
    revalidate: 60 // ISR: revalidate every 60s
  };
}`}</code>
        </pre>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">
          Examples
        </h2>
        <div className="space-y-2">
          <a
            href="/"
            className="block p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white hover:border-blue-500 transition-colors"
          >
            SSR Example (Home)
          </a>
          <a
            href="/static"
            className="block p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white hover:border-blue-500 transition-colors"
          >
            SSG Example with ISR
          </a>
        </div>
      </section>
    </article>
  );
}
