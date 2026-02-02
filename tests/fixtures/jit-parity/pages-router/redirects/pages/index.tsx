export default function RedirectPage() {
  return (
    <div>
      <h1>This should not be visible</h1>
      <p>If you see this, the redirect failed.</p>
    </div>
  );
}

export async function getServerData({ query }: { query: URLSearchParams }) {
  const shouldRedirect = query.get("redirect") === "true";
  const isPermanent = query.get("permanent") === "true";

  if (shouldRedirect) {
    return {
      redirect: {
        destination: "/target",
        permanent: isPermanent,
      },
    };
  }

  return {
    props: {},
  };
}
