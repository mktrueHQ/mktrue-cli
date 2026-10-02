import type { ReactNode } from "react";

if (process.env.NODE_ENV !== "development") {
  throw new Error("dev session: the @clerk/nextjs stand-in loaded outside next dev");
}

export function ClerkProvider({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}

export function SignOutButton({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}

export function SignIn(): ReactNode {
  return null;
}
