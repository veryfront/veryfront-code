import { Button } from "./components/Button";
import { useAuth } from "../hooks/useAuth";
import { formatDate } from "@/lib/utils";

export default function Page(): JSX.Element {
  const { user } = useAuth();

  return (
    <div>
      <p>Welcome, {user?.name}</p>
      <p>Last login: {formatDate(user?.lastLogin)}</p>
      <Button>Click me</Button>
    </div>
  );
}
