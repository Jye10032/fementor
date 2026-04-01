import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveApiOrigin() {
  const rawOrigin =
    process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

  if (/^https?:\/\//.test(rawOrigin)) {
    return rawOrigin;
  }

  return `http://${rawOrigin}`;
}

const API_ORIGIN = resolveApiOrigin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async rewrites() {
    return [
      {
        source: "/api/proxy/:path*",
        destination: `${API_ORIGIN}/:path*`,
      },
    ];
  },
};

export default nextConfig;
