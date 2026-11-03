/** @type {import('next').NextConfig} */
const nextConfig = {
  //output: 'export',
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: "https://theatre-manager-86e4e.firebaseapp.com/__/auth/:path*",
      },
    ];
  },
};

module.exports = nextConfig;

