interface PageProps {
  count: number;
  revalidatedAt: string;
}

export default function ISRPage({ count, revalidatedAt }: PageProps) {
  return (
    <div>
      <h1>ISR Test Page</h1>
      <p>View count: {count}</p>
      <p>Last revalidated: {revalidatedAt}</p>
    </div>
  );
}

export async function getStaticData() {
  return {
    props: {
      count: Math.floor(Math.random() * 100),
      revalidatedAt: new Date().toISOString(),
    },
    revalidate: 60, // Revalidate every 60 seconds
  };
}
