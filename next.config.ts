import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A Z.ai SDK usa APIs de Node e é carregada sob demanda no servidor
  serverExternalPackages: ["z-ai-web-dev-sdk"],
};

export default nextConfig;
