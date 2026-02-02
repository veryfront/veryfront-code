export default function JSXPage({ title = "JSX Component Page", count = 0 }) {
  return (
    <div className="jsx-page">
      <h1>{title}</h1>
      <p>Count: {count}</p>
    </div>
  );
}

export async function getServerData() {
  return {
    props: {
      title: "JSX Component Test",
      count: 42,
    },
  };
}
