export type SerializeByUser = <T>(userId: string, run: () => Promise<T>) => Promise<T>;
