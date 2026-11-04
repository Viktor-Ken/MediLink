import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, clearToken } from './api.js';
import { API_BASE } from './apiBase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api('/auth/me')
      .then((d) => setUser(d.staff))
      .catch(() => {
        clearToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(username, password) {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      noSessionRedirect: true,
    });
    setToken(data.token);
    setUser(data.staff);
    return data.staff;
  }

  // Exchange a verified Clerk session for a MediLink JWT. Uses fetch directly
  // because api() would attach the (possibly stale) MediLink token instead of
  // the Clerk token this endpoint needs.
  async function loginWithClerk(clerkToken, email) {
    const res = await fetch(`${API_BASE}/api/auth/clerk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clerkToken}` },
      body: JSON.stringify({ email: email || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Sign-in failed (${res.status})`);
    setToken(data.token);
    setUser(data.staff);
    return data.staff;
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithClerk, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);