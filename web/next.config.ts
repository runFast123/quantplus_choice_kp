import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "How it works" became "Method" (ADR-056); the old address keeps its links and ranking
  async redirects() {
    return [{ source: "/how-it-works", destination: "/method", permanent: true }];
  },
};

export default nextConfig;
