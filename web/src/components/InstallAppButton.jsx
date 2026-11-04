import { useEffect, useState } from 'react';

/**
 * Surfaces the browser's PWA install prompt as a visible button instead of
 * relying on the browser's own (often hidden-in-a-menu) affordance. Renders
 * nothing when there's nothing to offer: already installed/standalone,
 * already running inside the Electron desktop shell, or on a browser that
 * never fired `beforeinstallprompt` (notably iOS Safari, which has no such
 * event — "Add to Home Screen" there is a manual Share-sheet action with no
 * programmatic trigger, so there's nothing for a button to do).
 */
export default function InstallAppButton({ className = '' }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
  );

  useEffect(() => {
    function onBeforeInstallPrompt(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || window.medilinkDesktop?.isDesktop || !deferredPrompt) return null;

  async function install() {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // Whatever the choice, this specific prompt event can't be reused.
    setDeferredPrompt(null);
  }

  return (
    <button
      type="button"
      className={`btn btn-ghost btn-sm ${className}`.trim()}
      onClick={install}
      title="Install MediLink as an app"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 5, verticalAlign: -2 }}>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      Install app
    </button>
  );
}
