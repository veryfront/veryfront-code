interface PageProps {
  title: string;
  items: string[];
}

export default function TSXPage({ title = "TSX Component Page", items = [] }: PageProps) {
  return (
    <div className="tsx-page">
      <h1>{title}</h1>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export async function getServerData() {
  return {
    props: {
      title: "TSX Component Test",
      items: ["React", "TypeScript", "SSR"],
    },
  };
}
