import Fastify from "fastify";
import cors from "@fastify/cors";
import ingestRoute from "./routes/ingest";

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.message'],
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url,
          hostname: req.hostname,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        }),
        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },
    },
    trustProxy: true
  });

  app.register(cors, { origin: true });
  app.register(ingestRoute, { prefix: "/api" });

  // Health check endpoint
  app.get('/health', { logLevel: 'silent' }, async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  return app;
}
