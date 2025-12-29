import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/main.tsx", ],
  project: ["src/**/*.ts", "src/**/*.tsx", "src/*.ts", "src/*.tsx", "src/index.css"],
  paths: {
    "@/*": ["src/*"],
  },
  tailwind: true,

};

export default config;
