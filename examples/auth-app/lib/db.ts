
// Mock database for the example app
// In a real app, this would be a real database connection

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: number;
};

// In-memory store (will reset on server restart)
const users: User[] = [
  {
    id: 'user_1',
    email: 'user@example.com',
    // hash for "password"
    passwordHash: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', 
    name: 'Demo User',
    createdAt: Date.now(),
  },
];

export const db = {
  user: {
    findUnique: async ({ where }: { where: { email: string } }) => {
      return users.find((u) => u.email === where.email) || null;
    },
    create: async ({ data }: { data: Omit<User, 'id' | 'createdAt'> }) => {
      const newUser = { ...data, id: `user_${Date.now()}`, createdAt: Date.now() };
      users.push(newUser);
      return newUser;
    },
  },
};
