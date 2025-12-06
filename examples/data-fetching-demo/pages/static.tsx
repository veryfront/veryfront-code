interface StaticProps {
  data: {
    title: string;
    content: string;
  };
  buildTime: string;
}

export function getStaticData() {
  // This runs at build time
  return {
    props: {
      data: {
        title: "Static Generation Example",
        content: "This page was pre-rendered at build time.",
      },
      buildTime: new Date().toISOString(),
    },
    revalidate: 60, // Revalidate every 60 seconds (ISR)
  };
}

export default function StaticPage({ data, buildTime }: StaticProps) {
  return (
    <div>
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-4">
        {data.title}
      </h1>
      <div className="bg-neutral-50 dark:bg-neutral-800 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-700 mb-6">
        <p className="text-neutral-900 dark:text-white mb-2">{data.content}</p>
        <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-2">
          Built at: {new Date(buildTime).toLocaleString()}
        </p>
        <p className="text-neutral-500 dark:text-neutral-400 text-sm">
          This page uses ISR and will revalidate every 60 seconds.
        </p>
      </div>
      <a
        href="/"
        className="inline-flex px-5 py-2.5 bg-blue-500 text-white font-medium rounded-full hover:bg-blue-600 transition-colors"
      >
        Back to SSR Example
      </a>
    </div>
  );
}
