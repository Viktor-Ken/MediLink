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

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

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
    `connect-src 'self' ws: wss:${clerkSrc}`,
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

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

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

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
