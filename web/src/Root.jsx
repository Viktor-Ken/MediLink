import { useEffect, useState } from 'react';
import App from './App.jsx';
import { CLERK_PUBLISHABLE_KEY, clerkEnabled } from './clerk.js';

/**
 * Wraps the app in ClerkProvider only when a publishable key is configured.
 * The Clerk bundle is loaded on demand so installs that don't use SSO pay
 * nothing for it.
 */
export default function Root() {
  const [Provider, setProvider] = useState(null);
  const [ready, setReady] = useState(!clerkEnabled);

  useEffect(() => {
    if (!clerkEnabled) return undefined;
    let alive = true;
    import('@clerk/react')
      .then((mod) => {
        if (!alive) return;
        setProvider(() => mod.ClerkProvider);
        setReady(true);
      })
      .catch(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  if (!ready) return null;

  return Provider
    ? <Provider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/login"><App /></Provider>
    : <App />;
}
