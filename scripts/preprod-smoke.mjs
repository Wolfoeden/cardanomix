import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true } });
try {
  const { run } = await server.ssrLoadModule("/scripts/preprod-smoke.ts");
  await run(process.argv.includes("--prepare"));
} finally {
  await server.close();
}
