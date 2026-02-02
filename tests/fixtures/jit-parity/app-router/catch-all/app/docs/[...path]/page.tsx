interface PageProps {
  params: { path: string[] };
}

export default function DocsPage({ params }: PageProps) {
  const pathString = params.path?.join("/") || "index";
  return (
    <div>
      <h1>Documentation</h1>
      <p>Path: {pathString}</p>
      <p>Segments: {params.path?.length || 0}</p>
    </div>
  );
}

export async function getServerData({ params }: { params: { path: string[] } }) {
  return {
    props: {
      params,
      breadcrumbs: params.path || [],
    },
  };
}
