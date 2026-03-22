import { useQuery } from "@tanstack/react-query@5.90.5";

export default function UserProfile(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ["user"],
    queryFn: async () => {
      const res = await fetch("/api/user");
      return res.json();
    },
  });

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return <div>Hello, {data?.name}</div>;
}
