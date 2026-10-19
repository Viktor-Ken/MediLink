// Clerk is optional. It is enabled purely by the presence of a publishable key
// at build time. Only the *publishable* key lives in the browser — the Clerk
// secret key is never sent to the client and is used solely by the API server.
export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';
export const clerkEnabled = Boolean(CLERK_PUBLISHABLE_KEY);
