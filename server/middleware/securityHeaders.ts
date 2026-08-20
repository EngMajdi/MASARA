import type { Request, Response, NextFunction } from 'express';

// Phase 7G — baseline production HTTP security headers. Deliberately
// small: only headers that are unconditionally safe for this application
// regardless of deployment environment.
//
// NOT included, and why:
//   Content-Security-Policy — this is a Vite-built SPA served alongside a
//     JSON API from the same Express process; a CSP tight enough to be
//     meaningful risks breaking inline styles/scripts Vite's production
//     build may emit, and this phase's mandate is "do not blindly add a
//     CSP that breaks the existing application." A real CSP needs a
//     deliberate asset-by-asset audit, which is out of scope here.
//   Strict-Transport-Security — this deployment's TLS termination point
//     is not established by anything in this repository (no reverse-proxy
//     config, no guaranteed-HTTPS assumption anywhere else in the
//     codebase); enabling HSTS without that guarantee can permanently
//     break HTTP access for a client that later hits this app over plain
//     HTTP. Documented as a known limitation, not fabricated.
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}
