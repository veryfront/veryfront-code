interface PageProps {
  id: string;
  title: string;
}

export default function StaticPathPage({ id, title }: PageProps) {
  return (
    <div>
      <h1>{title}</h1>
      <p>Page ID: {id}</p>
    </div>
  );
}

export async function getStaticPaths() {
  return {
    paths: [
      { params: { id: "1" } },
      { params: { id: "2" } },
      { params: { id: "3" } },
    ],
    fallback: false,
  };
}

export async function getStaticData({ params }: { params: { id: string } }) {
  return {
    props: {
      id: params.id,
      title: `Page ${params.id}`,
    },
  };
}
