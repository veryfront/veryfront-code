interface HomeProps {
  message: string;
  timestamp: number;
}

export function getServerData() {
  // This runs on every request
  return {
    props: {
      message: "Hello from Server-Side Rendering!",
      timestamp: Date.now(),
    },
  };
}

export default function Home({ message, timestamp }: HomeProps) {
  return (
    <div>
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-4">
        Data Fetching Demo
      </h1>
      <div className="bg-neutral-50 dark:bg-neutral-800 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-700 mb-6">
        <p className="text-neutral-900 dark:text-white mb-2">{message}</p>
        <p className="text-neutral-500 dark:text-neutral-400 text-sm">
          Rendered at: {new Date(timestamp).toLocaleString()}
        </p>
      </div>

      <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">
        Examples
      </h2>
      <div className="space-y-2">
        <a
          href="/static"
          className="block p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white hover:border-blue-500 transition-colors"
        >
          <span className="font-medium">Static Generation Example</span>
          <span className="block text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
            View SSG with ISR
          </span>
        </a>
        <a
          href="/docs/getting-started"
          className="block p-4 bg-neutral-50 dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white hover:border-blue-500 transition-colors"
        >
          <span className="font-medium">Documentation</span>
          <span className="block text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
            View nested layout example
          </span>
        </a>
      </div>
    </div>
  );
}
