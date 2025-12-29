import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/main.tsx", ],
  project: ["src/**/*.ts", "src/**/*.tsx", "src/*.ts", "src/*.tsx"],
  paths: {
    "@/*": ["src/*"],
  }
};

export default config;
