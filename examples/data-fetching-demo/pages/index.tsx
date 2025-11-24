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
      <h1>Data Fetching Demo</h1>
      <p>{message}</p>
      <p>Rendered at: {new Date(timestamp).toLocaleString()}</p>

      <h2>Examples</h2>
      <ul>
        <li><a href="/static">View Static Generation Example</a></li>
        <li><a href="/docs/getting-started">View Documentation (with nested layout)</a></li>
      </ul>
    </div>
  );
}
