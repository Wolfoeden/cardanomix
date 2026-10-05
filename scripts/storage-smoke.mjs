import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true } });
try {
  const { run } = await server.ssrLoadModule("/scripts/storage-smoke.ts");
  await run();
} finally {
  await server.close();
}
