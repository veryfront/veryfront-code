export async function getServerSideProps() {
  return {
    props: {
      project: "nextjs",
      items: 10,
    },
  };
}

export default function BenchSsrDataPage({ project, items }) {
  return (
    <main id="bench-ssr-data-page">
      <h1>Next.js SSR data benchmark page</h1>
      <p>
        SSR data benchmark for {project} ({items} items)
      </p>
    </main>
  );
}
