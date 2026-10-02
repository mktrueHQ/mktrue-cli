import { config } from "./config";
import { connectMongo } from "../contexts/shared/infrastructure/mongo";
import { buildServer } from "./server";

async function main(): Promise<void> {
  const server = buildServer();

  if (config.mongo.uri) {
    await connectMongo({
      uri: config.mongo.uri,
      ...(config.mongo.dbName ? { dbName: config.mongo.dbName } : {}),
    });
  } else {
    server.log.warn("MONGO_URI is not set — starting without a database");
  }

  if (!config.auth.ownerUserId) {
    server.log.warn("OWNER_USER_ID is not set — every gated route will answer 503");
  }

  await server.listen({ port: config.port, host: config.host });
}

await main();
