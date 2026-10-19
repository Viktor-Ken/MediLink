import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SignIn, useAuth, useUser } from '@clerk/react';
import { clerkEnabled } from '../clerk.js';
import { useAuth as useAppAuth } from '../AuthContext.jsx';

export default function Sso() {
  const nav = useNavigate();
  const app = useAppAuth();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [error, setError] = useState('');
  const exchanging = useRef(false);

  useEffect(() => {
    if (!clerkEnabled) {
      nav('/login', { replace: true });
      return;
    }
    if (!isLoaded || !isSignedIn || exchanging.current) return;
    exchanging.current = true;
    (async () => {
      try {
        const clerkToken = await getToken();
        const email = user?.primaryEmailAddress?.emailAddress
          || user?.emailAddresses?.[0]?.emailAddress
          || '';
        await app.loginWithClerk(clerkToken, email);
        nav('/', { replace: true });
      } catch (err) {
        exchanging.current = false;
        setError(err.message || 'Single sign-on failed.');
      }
    })();
  }, [isLoaded, isSignedIn, user, getToken, app, nav]);

  if (!clerkEnabled) return null;

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark">✚</span>
          <div>
            <div className="brand-name">MediLink</div>
            <div className="brand-sub">Hospital Management System</div>
          </div>
        </div>
        <div className="login-title">Sign in</div>
        {error
          ? <div className="alert-error" style={{ margin: '10px 0' }}>{error}</div>
          : <p className="sso-status">Completing sign-in…</p>}
        <SignIn routing="hash" />
        <p className="legal-links">
          <a href="/login">← Use username &amp; password</a>
        </p>
      </div>
    </div>
  );
}
