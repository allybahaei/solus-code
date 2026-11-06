import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The packaged app is plain files served by the daemon.
  ...(process.env.SOLUS_PACKAGED ? { output: "export" as const } : {}),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
