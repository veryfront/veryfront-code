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
      <h1>Data Fetching</h1>
      <p>Learn how to fetch data in Veryfront applications.</p>

      <section>
        <h2>Server-Side Rendering (SSR)</h2>
        <p>Use <code>getServerData()</code> to fetch data on every request:</p>
        <pre>
          <code>{`export function getServerData() {
  return {
    props: {
      data: fetchData()
    }
  };
}`}</code>
        </pre>
        <p>This page was rendered at: <strong>{serverTime}</strong></p>
      </section>

      <section>
        <h2>Static Site Generation (SSG)</h2>
        <p>Use <code>getStaticData()</code> to pre-render pages at build time:</p>
        <pre>
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
        <h2>Examples</h2>
        <ul>
          <li><a href="/">SSR Example (Home)</a></li>
          <li><a href="/static">SSG Example with ISR</a></li>
        </ul>
      </section>
    </article>
  );
}
