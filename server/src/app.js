import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import patientRoutes from './routes/patients.js';
import scanRoutes from './routes/scans.js';
import departmentRoutes from './routes/departments.js';
import referralRoutes from './routes/referrals.js';
import handoffRoutes from './routes/handoffs.js';
import conversationRoutes from './routes/conversations.js';
import taskRoutes from './routes/tasks.js';
import inboxRoutes from './routes/inbox.js';
import appointmentRoutes from './routes/appointments.js';
import wardRoutes from './routes/wards.js';
import admissionRoutes from './routes/admissions.js';
import prescriptionRoutes from './routes/prescriptions.js';
import investigationRoutes from './routes/investigations.js';
import noteRoutes from './routes/notes.js';
import visitRoutes from './routes/visits.js';
import portalRoutes from './routes/portal.js';
import reportRoutes from './routes/reports.js';
import staffRoutes from './routes/staff.js';
import vitalRoutes from './routes/vitals.js';
import accountRoutes from './routes/account.js';
import chatRoutes from './routes/chat.js';
import { evaluateLicense, warnLicense } from './license.js';
import pool from './db.js';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

  // One JSON line per request: enough to actually trace an incident (which
  // request, how long, who, what status) without a new logging dependency.
  // Deliberately never includes the request/response body — this app
  // carries PHI, and a body could easily end up in there.
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const line = {
        ts: new Date().toISOString(),
        level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        reqId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        staffId: req.staff?.id,
        patientId: req.patientId,
      };
      (line.level === 'error' ? console.error : console.log)(JSON.stringify(line));
    });
    next();
  });

  const corsOrigin = process.env.CORS_ORIGIN;
  app.use(cors(corsOrigin
    ? { origin: corsOrigin.split(',').map((o) => o.trim()) }
    : { origin: false }));
  app.use(compression());
  app.use(express.json({ limit: '256kb' }));

  // Clerk (optional SSO) needs its own origins in the policy. When Clerk is not
  // configured the policy stays as strict as before.
  const clerkOn = Boolean(process.env.CLERK_PUBLISHABLE_KEY || process.env.CLERK_ISSUER);
  const clerkSrc = clerkOn ? ' https://*.clerk.accounts.dev https://*.clerk.com' : '';
  const csp = [
    "default-src 'self'",
    clerkOn ? `script-src 'self' https://challenges.cloudflare.com${clerkSrc}` : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${clerkSrc}`,
    "font-src 'self' data:",
    // No part of this app opens a WebSocket/EventSource connection, so there
    // is nothing for a 'ws:'/'wss:' allowance to legitimately cover — it was
    // previously scheme-only (no host restriction), which would have let an
    // XSS exfiltrate data to any attacker-controlled wss:// endpoint.
    `connect-src 'self'${clerkSrc}`,
    clerkOn ? `frame-src 'self' https://challenges.cloudflare.com${clerkSrc}` : "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'self' blob:",
  ].join('; ');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', csp);
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  });

  app.use((req, _res, next) => {
    req.setTimeout(60_000, () => { if (!req.destroyed) req.destroy(); });
    next();
  });

  // A health check that only confirms the process is up misses the most
  // common real failure (the DB is unreachable but the Node process is
  // fine), so this actually pings Postgres rather than returning ok:true
  // unconditionally. Kept fast (a trivial query against an already-warm
  // pool) and bounded (won't hang a load balancer's health probe forever
  // if the DB is stuck).
  app.get('/api/health', async (_req, res) => {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('health check timed out')), 3000);
    });
    try {
      await Promise.race([pool.query('SELECT 1'), timeout]);
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unreachable' });
    }
  });

  const license = evaluateLicense();
  warnLicense(license);
  app.use('/api', (req, res, next) => {
    if (req.path === '/health') return next();
    if (license.locked) {
      res.setHeader('Retry-After', '86400');
      return res.status(403).json({ error: 'This software license has expired. Contact the vendor to renew.', code: 'LICENSE_LOCKED' });
    }
    next();
  });

  app.use('/api/auth',           authRoutes);
  app.use('/api/patients',      patientRoutes);
  app.use('/api/scans',         scanRoutes);
  app.use('/api/departments',   departmentRoutes);
  app.use('/api/referrals',     referralRoutes);
  app.use('/api/handoffs',      handoffRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/tasks',         taskRoutes);
  app.use('/api/inbox',         inboxRoutes);
  app.use('/api/appointments',  appointmentRoutes);
  app.use('/api/wards',         wardRoutes);
  app.use('/api/admissions',    admissionRoutes);
  app.use('/api/prescriptions', prescriptionRoutes);
  app.use('/api/investigations',investigationRoutes);
  app.use('/api/notes',         noteRoutes);
  app.use('/api/visits',        visitRoutes);
  app.use('/api/portal',        portalRoutes);
  app.use('/api/reports',       reportRoutes);
  app.use('/api/staff',         staffRoutes);
  app.use('/api/vitals',        vitalRoutes);
  app.use('/api/account',       accountRoutes);
  app.use('/api/chat',          chatRoutes);

  const dist = resolve(__dirname, '../../web/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: 'index.html' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(join(dist, 'index.html'));
    });
  }

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err, req, res, _next) => {
    // Body-parser failures (malformed JSON, oversized body) are client errors.
    const status = Number(err?.status || err?.statusCode);
    if (status >= 400 && status < 500) {
      return res.status(status).json({
        error: status === 413 ? 'Request body too large' : 'Invalid request',
      });
    }
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', reqId: req.id, err: err?.message, stack: err?.stack }));
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
