interface PageProps {
  params: { slug: string };
}

export default function PostPage({ params }: PageProps) {
  return (
    <div>
      <h1>Post: {params.slug}</h1>
      <p>This is a dynamic route page.</p>
    </div>
  );
}

export async function getServerData({ params }: { params: { slug: string } }) {
  return {
    props: {
      params,
      fetchedAt: new Date().toISOString(),
    },
  };
}
