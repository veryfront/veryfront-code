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
    passwordHash: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
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
