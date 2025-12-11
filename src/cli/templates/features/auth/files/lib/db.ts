
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

export const db = {
  user: {
    findUnique: ({ where }: { where: { email: string } }): Promise<User | null> => {
      return Promise.resolve(users.find((u) => u.email === where.email) || null);
    },
    create: ({ data }: { data: Omit<User, "id" | "createdAt"> }): Promise<User> => {
      const newUser = { ...data, id: `user_${Date.now()}`, createdAt: Date.now() };
      users.push(newUser);
      return Promise.resolve(newUser);
    },
  },
};
