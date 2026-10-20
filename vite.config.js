import { defineConfig } from 'vite';

// The site is published by GitHub Pages at https://<user>.github.io/frankenstein-sda-robert-jordan/
// so every URL Vite writes into the build must carry the repository name as a prefix.
// Runtime fetches use import.meta.env.BASE_URL, which Vite fills in from this same value.
export default defineConfig({
  base: '/frankenstein-sda-robert-jordan/',
  build: {
    outDir: 'dist',
    // three.js alone is ~700 kB minified; raise the warning threshold so real problems stand out.
    chunkSizeWarningLimit: 1200,
  },
});
