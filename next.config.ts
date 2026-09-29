import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript runs as a separate build step in netlify.toml.
  typescript: { ignoreBuildErrors: true },
  experimental: { cpus: 1, workerThreads: true },
};

export default nextConfig;
