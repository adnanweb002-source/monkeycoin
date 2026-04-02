# Security Analysis & Hardening Plan (Vaultire)

## Executive Summary (Top Risks)
1. **High: Cookie-based JWT lacks CSRF protection**
   - JWT is transported via cookies (`access_token`, `refresh_token`) with CORS enabled for credentials, but there is no CSRF mitigation.
2. **High: Missing global request validation/throttling**
   - No visible `ValidationPipe` (DTO constraints are not guaranteed to be enforced), and there is no visible rate limiting / brute-force protection for auth and 2FA.
3. **High: WebSocket hardening gaps**
   - WebSocket gateway uses wildcard CORS and logs raw cookies (including JWT contents).
4. **High: Unprotected Bull Board dashboard**
   - Bull Board is served by a separate Express server without authentication/authorization.

## Threat Model

### Primary assets
1. Financial ledgers and wallet balances (credit/debit, deposit/withdrawal requests).
2. User accounts and authentication tokens (JWT access + refresh cookies).
3. 2FA secrets and reset flows.
4. Admin capabilities (user suspension, wallet limits, pruning/system actions).
5. Notification channels and job/queue infrastructure (BullMQ, Bull Board).

### Adversaries
1. **Anonymous attacker**: can hit public HTTP endpoints and attempt replay/guessing and injection attacks.
2. **Authenticated non-admin user**: can exploit authorization flaws (IDOR, missing role enforcement).
3. **Compromised admin account**: can abuse admin endpoints and backdoors.
4. **Network attacker / misconfigured gateway**: attempts to forge payment callbacks (webhooks/IPN).
5. **Malicious third-party website**: attempts CSRF against cookie-authenticated endpoints.

### Trust boundaries
1. Browser ↔ API (cookie auth with CORS).
2. Payment gateway ↔ API (webhook/IPN).
3. Browser ↔ WebSocket gateway (JWT via cookie).
4. Admin UI / ops tools ↔ Bull Board (separate Express process).
5. API ↔ Background worker (mail notifications via BullMQ).

## Attack Surface Map

### HTTP API (NestJS on port `3000`)
Key auth primitives:
- JWT is extracted from cookies (`access_token`) in [`src/auth/jwt.strategy.ts`](src/auth/jwt.strategy.ts).
- Cookies are set/cleared in [`src/auth/auth.controller.ts`](src/auth/auth.controller.ts) (notably `sameSite` varies by endpoint).

### WebSocket (notifications)
WebSocket connections are authenticated by JWT in cookie headers in [`src/notifications/notifications.gateway.ts`](src/notifications/notifications.gateway.ts), but:
- CORS is set to `origin: '*'`.
- Raw cookies are logged on connection.

### Bull Board dashboard (separate Express server)
Bull Board is served from [`src/dashboard/bull-board.ts`](src/dashboard/bull-board.ts) with:
- No auth/guard middleware.
- Base path `/admin/queues` on port `3001`.

## Findings & Recommendations (Prioritized)


**Code evidence**
- Route exists without `@UseGuards(...)` in [`src/wallets/wallet.controller.ts`](src/wallets/wallet.controller.ts).

**Impact**
- Any external actor can forge deposit confirmations, crediting `D_WALLET` balances for arbitrary `userId`.

**Fix**
1. Require an authentication mechanism appropriate for payment systems:
   - Prefer **payment gateway signature verification** (HMAC/Ed25519) over shared secrets.
   - Verify timestamp/nonce to prevent replay.
2. Ensure webhook handler validates:
   - expected fields
   - signature validity
   - deposit status transition (idempotency via `ExternalDeposit.paymentId`)
3. If webhooks are expected from a trusted gateway only:
   - lock endpoint to gateway IP ranges at the network layer (WAF/reverse proxy).

### 3) High — Cookie-based JWT with no CSRF defenses
**What’s happening**
- API uses cookies (`access_token`, `refresh_token`) for auth.
- CORS is configured with `credentials: true`, but there is no visible CSRF token enforcement.
- Cookie `sameSite` is `lax` for login/register and `none` for refresh.

**Code evidence**
- JWT extraction from cookies: [`src/auth/jwt.strategy.ts`](src/auth/jwt.strategy.ts)
- Cookie settings include `sameSite: 'lax'` / `sameSite: 'none'`: [`src/auth/auth.controller.ts`](src/auth/auth.controller.ts)
- CORS with credentials: [`src/main.ts`](src/main.ts)

**Impact**
- Browser-based attackers can potentially trigger authenticated state-changing requests (CSRF), depending on cookie attributes and browser behavior.

**Fix**
1. Add CSRF protection for cookie-authenticated endpoints:
   - CSRF tokens (double-submit cookie pattern) for state-changing requests.
2. Consider:
   - `SameSite=Strict` for access token cookies (if your frontend allows).
   - requiring an additional header (e.g., `X-Requested-With`) verified server-side for non-idempotent actions.
3. For refresh:
   - prefer rotating refresh tokens with strict CSRF validation.

### 4) High — No visible global validation and no throttling
**What’s happening**
- There is no visible `useGlobalPipes(new ValidationPipe(...))` in the bootstrap.
- There is no visible rate limiting for auth, password reset, and 2FA endpoints.

**Code evidence**
- Bootstrap (`src/main.ts`) does not configure `ValidationPipe` or rate limiting.

**Impact**
- Increased likelihood of malformed inputs causing:
  - logic errors
  - inconsistent behavior
  - brute-force feasibility (login/2FA/OTP guessing)

**Fix**
1. Add global validation:
   - `useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))`
2. Add rate limiting / abuse detection:
   - IP + account based throttling for:
     - `POST /auth/login`
     - 2FA change/setup/verify (even if not load-tested with codes)
     - password reset and 2FA reset request endpoints
3. Add lockout / exponential backoff for repeated failed authentications.

### 5) High — WebSocket hardening and sensitive logging issues
**What’s happening**
- WebSocket gateway uses wildcard CORS and logs raw cookie strings on connection.

**Code evidence**
- `cors: { origin: '*' }` and logging `Cookies: ${rawCookie}` in [`src/notifications/notifications.gateway.ts`](src/notifications/notifications.gateway.ts).

**Impact**
- JWT leakage in logs (high value for attackers).
- Increased exposure surface for cross-origin websocket attempts.

**Fix**
1. Restrict websocket CORS origins to exact allowed frontends.
2. Remove raw cookie logging; log only safe metadata (e.g., user id, request id).
3. Consider short-lived websocket auth and re-auth on token expiry.

### 6) High — Bull Board dashboard unprotected
**What’s happening**
- Separate Express server serves Bull Board without auth.

**Code evidence**
- Bull Board setup in [`src/dashboard/bull-board.ts`](src/dashboard/bull-board.ts); no guards.

**Impact**
- Unauthorized users can inspect job contents and, depending on Bull Board features, potentially trigger queue operations.

**Fix**
1. Protect Bull Board behind:
   - admin auth middleware (JWT) or an API gateway auth layer.
2. Restrict access by network policy (VPN/IP allowlist).

### 7) High — Payment IPN signature default secret fallback
**What’s happening**
- IPN signature verification uses:
  - `process.env.NOWPAYMENTS_IPN_SECRET || 'default_secret'`

**Code evidence**
- `verifySignature()` in [`src/wallets/wallet.controller.ts`](src/wallets/wallet.controller.ts).

**Impact**
- If `NOWPAYMENTS_IPN_SECRET` is misconfigured or missing, an attacker can forge signatures knowing the default.

**Fix**
1. Remove fallback; fail closed if secret is not set.
2. Rotate secrets and enforce least privilege on webhook signing keys.

### 8) Medium — 2FA robustness and operational gaps
**What’s happening**
- 2FA uses TOTP verified by `speakeasy` with a window.
- There are admin override/reset flows.

**Code evidence**
- TOTP verification and secret encryption/decryption in [`src/auth/twofactor.service.ts`](src/auth/twofactor.service.ts).

**Impact**
- Without throttling, TOTP brute force is feasible.
- Secret encryption relies on correct `AES_KEY` management; missing/weak key management increases risk.

**Fix**
1. Enforce request throttling for all 2FA-related endpoints.
2. Add rate limiting for OTP verification attempts.
3. Implement audit logging and alerts for repeated 2FA failures.
4. Add key rotation plan for `AES_KEY`.

### 9) Medium — Potential HTML/script injection via email templating data
**What’s happening**
- Email template HTML strings include user-controlled content and interpolations.

**Code evidence**
- Email content construction and HTML snippets in [`src/auth/auth.service.ts`](src/auth/auth.service.ts) (avatar and profile update usage).

**Impact**
- Stored XSS risk in administrative views that render email/notification content (depends on how templates are displayed in your UI).
- In some clients, malformed HTML can cause unintended rendering.

**Fix**
1. Escape/sanitize user-provided fields before embedding into HTML.
2. Use a template engine with auto-escaping.
3. Add security tests for notification rendering (if applicable).

## Remediation Roadmap (Practical Order)

### Phase 0 (Immediate, 1–2 days)
1. Remove sensitive logs:
   - stop logging raw cookies in websocket gateway.
2. Protect Bull Board:
   - require admin authentication (JWT) and restrict network access.

### Phase 1 (Short-term, 1–2 weeks)
1. Add CSRF protection for cookie-authenticated endpoints.
2. Add global validation:
   - `ValidationPipe` with whitelist + forbid non-whitelisted.
3. Add rate limiting:
   - auth login/refresh/logout, password reset, 2FA verification/change.

### Phase 2 (Medium-term, 2–6 weeks)
1. Harden websocket:
   - restrict websocket CORS, tighten auth flow, reduce log data.
2. Eliminate “default secret” fallbacks for payment IPN signature verification.
3. Add security regression tests:
   - CSRF tests
   - unauthorized webhook tests
   - IDOR tests
   - rate limit enforcement tests

### Phase 3 (Ongoing)
1. Secret management & rotation (AES_KEY, JWT secrets, webhook signing keys).
2. Continuous monitoring:
   - alert on abnormal auth/OTP failures
   - alert on webhook signature failures
3. Security reviews for admin “backdoor” endpoints.

## Appendix: High-value Regression Tests to Add
- k6/automated:
  - verify websocket refuses connections without valid cookies
  - verify Bull Board rejects unauthenticated requests

## Verification Plan (How to Prove Fixes)

### Webhook & Payment Callback Security
1. **IPN signature verification must fail closed**
   - Check: if `NOWPAYMENTS_IPN_SECRET` is missing, the endpoint must reject requests (no default secret).
   - Automate: run a test environment with `NOWPAYMENTS_IPN_SECRET` unset and assert `POST /wallet/payments/ipn` returns `401`.

### CSRF & Cookie Auth Protections
1. **State-changing endpoints must require CSRF token**
   - Check: cookie-authenticated `POST/PATCH/DELETE` requests without CSRF token are rejected (typically `403`).
   - Automate: add an e2e/supertest test harness or a targeted k6 scenario that omits CSRF headers.
2. **Cookie attributes must be consistent and intentional**
   - Check: `SameSite` strategy matches your CSRF plan (and refresh cookies do not weaken security inadvertently).

### Rate Limiting & Brute-force Controls
1. **Login throttling**
   - Check: repeated `POST /auth/login` failures from the same IP/account eventually return `429`.
   - Automate: implement a k6 “failed login loop” scenario with low concurrency and assert `429` appears.
2. **2FA attempt throttling**
   - Check: repeated invalid 2FA verification returns `429` and does not degrade system performance.
   - Automate: use the 2FA endpoints with invalid code placeholders and assert throttling behavior.

### WebSocket Hardening
1. **Origin restriction**
   - Check: websocket connections from unapproved origins fail.
2. **Sensitive logging removal**
   - Check: logs no longer contain `access_token`/raw cookies.
   - Automate: run one websocket connection in test and grep logs for `access_token` (or confirm structured log fields).

### Input Validation & Abuse Resilience
1. **DTO validation is enforced globally**
   - Check: invalid payloads (missing required fields, unexpected fields) return `400`.
2. **Whitelisting is enabled**
   - Check: unexpected fields do not reach service logic.

### Admin & Ops Surfaces
1. **Bull Board authorization**
   - Check: unauthenticated requests to Bull Board endpoints return `401/403`.
   - Automate: add a k6 check against `http://<host>:3001/admin/queues` (or your configured base) for forbidden access.

### Performance Regression Expectations
- After security hardening:
  - Ensure load tests still meet baseline SLAs (e.g., `http_req_failed` stays near 0).
  - Validate that rate limiting doesn’t cause widespread timeouts during normal traffic.


