import mongoose from "mongoose";

export interface MongoConnection {
  readonly uri: string;
  readonly dbName?: string;
  readonly serverSelectionTimeoutMs?: number;
}

export async function connectMongo(connection: MongoConnection): Promise<void> {
  const { uri, dbName, serverSelectionTimeoutMs } = connection;
  await mongoose.connect(uri, {
    ...(dbName ? { dbName } : {}),
    ...(serverSelectionTimeoutMs ? { serverSelectionTimeoutMS: serverSelectionTimeoutMs } : {}),
  });
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}
