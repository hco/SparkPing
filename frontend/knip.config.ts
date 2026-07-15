import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/main.tsx", ],
  project: ["src/**/*.ts", "src/**/*.tsx", "src/*.ts", "src/*.tsx", "src/index.css"],
  paths: {
    "@/*": ["src/*"],
  },
  tailwind: true,
  // shadcn/ui components and the generated route tree are kept in full; don't
  // flag their unused members.
  ignore: ["src/components/ui/**", "src/routeTree.gen.ts"],
  // Radix packages backing ignored shadcn components.
  ignoreDependencies: ["@radix-ui/react-collapsible", "@radix-ui/react-tabs"],
  // Don't flag exports that are only consumed within their own file (e.g. a
  // base hook wrapped by convenience hooks).
  ignoreExportsUsedInFile: true,
};

export default config;
