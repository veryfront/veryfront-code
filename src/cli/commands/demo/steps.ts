export interface DemoStep {
  id: string;
  title: string;
  description: string[];
  command?: string;
  hasAction?: boolean;
  skipPostWait?: boolean;
}

export const DEMO_STEPS: DemoStep[] = [
  {
    id: "intro",
    title: "Welcome to Veryfront",
    description: [
      "Veryfront is a zero-config React meta-framework with AI-native capabilities.",
      "This demo will walk you through creating, running, and deploying your first app.",
    ],
  },
  {
    id: "login",
    title: "Sign In",
    description: [
      "First, let's sign in to your Veryfront account.",
      "This opens your browser for OAuth authentication.",
    ],
    command: "veryfront login",
    hasAction: true,
  },
  {
    id: "create",
    title: "Create a Project",
    description: [
      "Now let's create a new project.",
      "No npm install required - Veryfront uses Deno with URL imports.",
    ],
    command: "veryfront new demo-app",
    hasAction: true,
  },
  {
    id: "dev",
    title: "Start Development",
    description: [
      "Start the development server with hot module replacement.",
      "Your app will be available at http://localhost:3000.",
    ],
    command: "veryfront dev",
    hasAction: true,
    skipPostWait: true,
  },
  {
    id: "deploy",
    title: "Deploy to Production",
    description: [
      "Deploy your app to Veryfront's global edge network with a single command.",
      "No build step required - we handle that for you.",
    ],
    command: "veryfront deploy",
    hasAction: true,
  },
  {
    id: "done",
    title: "You're All Set!",
    description: [
      "Congratulations! Your app is now live on the web.",
      "Check out the docs at https://veryfront.com/docs for more features.",
    ],
  },
];
