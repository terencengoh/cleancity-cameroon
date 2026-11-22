import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static build (dist/): host on any static host. base "./" keeps asset paths relative.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
