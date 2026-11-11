import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rendered on the server only (invoice PDFs); keep it out of the bundler.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
