import { QueryClient as _QueryClient, useQuery } from "@tanstack/react-query";

export default function UserProfile() {
  const { data, isLoading } = useQuery({
    queryKey: ["user"],
    queryFn: () => fetch("/api/user").then((res) => res.json()),
  });

  if (isLoading) return <div>Loading...</div>;
  return <div>Hello, {data?.name}</div>;
}
