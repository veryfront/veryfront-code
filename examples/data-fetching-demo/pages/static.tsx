interface StaticProps {
  data: {
    title: string;
    content: string;
  };
  buildTime: string;
}

export function getStaticData() {
  // This runs at build time
  return {
    props: {
      data: {
        title: "Static Generation Example",
        content: "This page was pre-rendered at build time.",
      },
      buildTime: new Date().toISOString(),
    },
    revalidate: 60, // Revalidate every 60 seconds (ISR)
  };
}

export default function StaticPage({ data, buildTime }: StaticProps) {
  return (
    <div>
      <h1>{data.title}</h1>
      <p>{data.content}</p>
      <p>Built at: {new Date(buildTime).toLocaleString()}</p>
      <p>This page uses ISR and will revalidate every 60 seconds.</p>
      <p>
        <a href="/">Back to SSR Example</a>
      </p>
    </div>
  );
}
