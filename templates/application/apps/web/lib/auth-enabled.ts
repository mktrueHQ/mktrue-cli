const isSet = (value: string | undefined): boolean => value !== undefined && value !== "";

export function clerkKeysSet(env: NodeJS.ProcessEnv): boolean {
  return isSet(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && isSet(env.CLERK_SECRET_KEY);
}

export function devSessionOn(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "development" && isSet(env.DEV_AUTH_USER_ID);
}

export function authEnabled(env: NodeJS.ProcessEnv): boolean {
  return clerkKeysSet(env) || devSessionOn(env);
}
