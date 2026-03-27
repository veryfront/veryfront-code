export type User = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: number;
};

const users: User[] = [
  {
    id: "user_1",
    email: "demo@example.com",
    passwordHash: "deadbeefcafebabe0123456789abcdef:0f09709d32356f0ca33abf7ddb6ffc7c23a373c2d21661a71170de868df74eee",
    name: "Demo User",
    createdAt: Date.now(),
  },
];

function findUserByEmail(email: string): User | null {
  return users.find((u) => u.email === email) ?? null;
}

function createUser(data: Omit<User, "id" | "createdAt">): User {
  const now = Date.now();
  const user: User = { ...data, id: `user_${now}`, createdAt: now };
  users.push(user);
  return user;
}

export const db = {
  user: {
    findUnique({ where }: { where: { email: string } }): Promise<User | null> {
      return Promise.resolve(findUserByEmail(where.email));
    },
    create({ data }: { data: Omit<User, "id" | "createdAt"> }): Promise<User> {
      return Promise.resolve(createUser(data));
    },
  },
};
