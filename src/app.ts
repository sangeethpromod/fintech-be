import Fastify from "fastify";
import cors from "@fastify/cors";
import ingestRoute from "./routes/ingest";

export function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: true
  });

  app.register(cors, { origin: true });
  app.register(ingestRoute, { prefix: "/ingest" });

  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  return app;
}
