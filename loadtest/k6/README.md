# k6 Load Tests (NestJS / Cookie JWT)

## Requirements
- `k6` installed locally (or in your CI runner)
- A running instance of the API (use staging by default)

## Run
Smoke + ramp (smoke runs the full endpoint suite once, ramp focuses on safe checks):
```bash
k6 run loadtest/k6/scenarios/all-endpoints.js
```

Configure environment variables:
```bash
BASE_URL=http://localhost:3000
ADMIN_API_KEY=...           # x-api-key for POST /admin/bootstrap/company
ADMIN_EMAIL=company@monkeycoin.com
ADMIN_PASSWORD=company_secure_password
K6_SMOKE_VUS=1
K6_SMOKE_DURATION=30       # seconds

K6_RAMP_START_VUS=2
# Default ramp stages: 30s->5 VUs, 1m->10 VUs, 1m->20 VUs
#
# Optionally override:
# K6_RAMP_STAGES_JSON='[{"duration":"30s","target":5},{"duration":"1m","target":10},{"duration":"1m","target":20}]'
```

## Notes
- This repo stores JWT in cookies: `access_token` and `refresh_token`.
- The test suite bootstraps the `COMPANY` admin account and then registers a user.
- By design, endpoints requiring a TOTP code input are excluded from the full run.
  (Specifically: `/auth/change-password`, `/auth/change-email`, `/auth/2fa/verify`, `/auth/2fa/change/initiate`, `/auth/2fa/change/confirm`.)
- Destructive endpoints are executed only during the `smoke` phase (once) to reduce the chance of deleting data mid-test.

