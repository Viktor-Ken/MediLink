import { createPublicKey } from 'node:crypto';
import jwt from 'jsonwebtoken';

/**
 * Optional Clerk (SSO) integration.
 *
 * Identity is delegated to Clerk; MediLink still issues its own short-lived JWT
 * after it maps the verified Clerk user to a provisioned staff row. This keeps
 * RBAC, audit trails and the rest of the API unchanged, and means no Clerk
 * secret ever reaches the browser.
 *
 * Enable by setting (server-side only):
 *   CLERK_SECRET_KEY   — Clerk secret key (never exposed to the client)
 *   CLERK_ISSUER       — e.g. https://your-app.clerk.accounts.dev
 * Optional:
 *   CLERK_JWKS_URL     — override JWKS location (defaults to <issuer>/.well-known/jwks.json)
 *   CLERK_AUTHORIZED_PARTIES — comma-separated `azp` values to accept
 */

const JWKS_TTL_MS = 10 * 60 * 1000;

let jwksCache = { at: 0, keys: new Map() };

export function clerkConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY && jwksUrl());
}

function issuer() {
  return (process.env.CLERK_ISSUER || '').replace(/\/+$/, '');
}

function jwksUrl() {
  if (process.env.CLERK_JWKS_URL) return process.env.CLERK_JWKS_URL;
  const iss = issuer();
  return iss ? `${iss}/.well-known/jwks.json` : '';
}

async function loadJwks(force = false) {
  const fresh = Date.now() - jwksCache.at < JWKS_TTL_MS;
  if (!force && fresh && jwksCache.keys.size) return jwksCache.keys;

  const res = await fetch(jwksUrl());
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const { keys } = await res.json();
  const map = new Map();
  for (const k of keys || []) {
    if (k.kid && k.kty === 'RSA') map.set(k.kid, k);
  }
  jwksCache = { at: Date.now(), keys: map };
  return map;
}

function jwkToPem(jwk) {
  return createPublicKey({ key: jwk, format: 'jwk' })
    .export({ type: 'spki', format: 'pem' });
}

/**
 * Verify a Clerk session token and return its claims.
 * Throws on any failure (callers must treat a throw as 401).
 */
export async function verifyClerkSession(token) {
  if (!clerkConfigured()) throw new Error('Clerk is not configured');

  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded?.header?.kid;
  if (!decoded || !kid) throw new Error('Malformed Clerk token');

  let keys = await loadJwks();
  if (!keys.has(kid)) keys = await loadJwks(true);
  const jwk = keys.get(kid);
  if (!jwk) throw new Error('Unknown Clerk signing key');

  const claims = jwt.verify(token, jwkToPem(jwk), {
    algorithms: ['RS256'],
    issuer: issuer() || undefined,
  });

  const parties = (process.env.CLERK_AUTHORIZED_PARTIES || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (parties.length && !parties.includes(claims.azp)) {
    throw new Error('Untrusted authorized party');
  }
  return claims;
}

/**
 * Verified email addresses for a Clerk user, fetched server-side from Clerk's
 * Backend API. Never trust an email supplied by the browser: only addresses
 * Clerk itself reports as verified may be used to link a staff account.
 * Returns [] on any failure (callers then refuse to link).
 */
export async function fetchVerifiedEmails(userId, fetchImpl = fetch) {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret || !userId) return [];
  try {
    const res = await fetchImpl(
      `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!res.ok) return [];
    const user = await res.json();
    return (user.email_addresses || [])
      .filter((e) => e?.verification?.status === 'verified' && e.email_address)
      .map((e) => String(e.email_address).trim().toLowerCase());
  } catch {
    return [];
  }
}
