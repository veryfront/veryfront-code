interface PageProps {
  items: string[];
  generatedAt: string;
}

export default function StaticDataPage({ items, generatedAt }: PageProps) {
  return (
    <div>
      <h1>Static Data Test</h1>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      <p>Generated at: {generatedAt}</p>
    </div>
  );
}

export async function getStaticData() {
  return {
    props: {
      items: ["Item 1", "Item 2", "Item 3"],
      generatedAt: new Date().toISOString(),
    },
  };
}
