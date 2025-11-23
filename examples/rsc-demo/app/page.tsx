/**
 * Example RSC page demonstrating server components
 */

import ClientCounter from "./ClientCounter.client.tsx";

// This is a server component by default
export default async function HomePage() {
  // Server components can be async and fetch data directly
  const serverTime = new Date().toISOString();

  // Simulate data fetching
  const data = await fetchData();

  return (
    <div style={{ padding: "20px", fontFamily: "system-ui" }}>
      <h1>Veryfront RSC Demo</h1>

      <section>
        <h2>Server Component</h2>
        <p>This content is rendered on the server.</p>
        <p>Server time: {serverTime}</p>
        <p>Fetched data: {data.message}</p>
      </section>

      <section>
        <h2>Client Component</h2>
        <p>The counter below is a client component with interactivity:</p>
        <ClientCounter initialCount={10} />
      </section>

      <section>
        <h2>Benefits</h2>
        <ul>
          <li>✅ Server components have zero client-side JavaScript</li>
          <li>✅ Direct database/API access on the server</li>
          <li>✅ Client components only ship interactive code</li>
          <li>✅ Automatic code splitting at component boundaries</li>
        </ul>
      </section>
    </div>
  );
}

// Server-side data fetching
async function fetchData() {
  // Simulate API call
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    message: "Hello from the server!",
    timestamp: Date.now(),
  };
}
