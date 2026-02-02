interface PageProps {
  message: string;
  timestamp: string;
}

export default function ServerDataPage({ message, timestamp }: PageProps) {
  return (
    <div>
      <h1>Server Data Test</h1>
      <p>{message}</p>
      <p>Fetched at: {timestamp}</p>
    </div>
  );
}

export async function getServerData() {
  return {
    props: {
      message: "Data fetched from server",
      timestamp: new Date().toISOString(),
    },
  };
}
