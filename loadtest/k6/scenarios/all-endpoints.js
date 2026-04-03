import http from 'k6/http';
import { check } from 'k6';
import { endpointCatalog, AuthMode } from '../endpoints.js';
import { bootstrapCompany, login, registerUser, authCookieHeaders } from '../auth.js';
import { makeRegisterDto } from '../payloads.js';

function authHeaders(ctx, mode, userIdx = 0) {
  if (mode === AuthMode.PUBLIC) return {};
  if (mode === AuthMode.ADMIN) {
    return authCookieHeaders(ctx.admin.tokens);
  }
  if (mode === AuthMode.USER) {
    const user = ctx.users[userIdx];
    return authCookieHeaders(user.tokens);
  }
  return {};
}

function getAuthHeaderFromUser(ctx, userIdx = 0) {
  const user = ctx.users[userIdx];
  return authCookieHeaders(user.tokens);
}

function resolvePath(path, params = {}) {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_, name) =>
    encodeURIComponent(String(params[name])),
  );
}

function jsonOrNull(res) {
  try {
    return res.json();
  } catch (e) {
    return null;
  }
}

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: __ENV.K6_SMOKE_VUS ? Number(__ENV.K6_SMOKE_VUS) : 1,
      duration: __ENV.K6_SMOKE_DURATION ? `${__ENV.K6_SMOKE_DURATION}s` : '30s',
      env: { K6_FULL_SUITE: 'true' },
    },
    ramp: {
      executor: 'ramping-vus',
      startVUs: __ENV.K6_RAMP_START_VUS ? Number(__ENV.K6_RAMP_START_VUS) : 2,
      stages: __ENV.K6_RAMP_STAGES_JSON
        ? JSON.parse(__ENV.K6_RAMP_STAGES_JSON)
        : [
            { duration: '30s', target: 5 },
            { duration: '1m', target: 10 },
            { duration: '1m', target: 20 },
          ],
      gracefulStop: '20s',
      env: { K6_FULL_SUITE: 'false' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const baseUrl = __ENV.BASE_URL;
  if (!baseUrl) throw new Error('Missing BASE_URL env var (e.g., http://localhost:3000)');

  const adminApiKey = __ENV.ADMIN_API_KEY;
  if (!adminApiKey) throw new Error('Missing ADMIN_API_KEY env var (x-api-key for /admin/bootstrap/company)');

  const adminEmail = __ENV.ADMIN_EMAIL || 'company@monkeycoin.com';
  const adminPassword = __ENV.ADMIN_PASSWORD || 'company_secure_password';

  const userCount = __ENV.LOADTEST_USERS ? Number(__ENV.LOADTEST_USERS) : 2;
  const creditAmount = __ENV.LOADTEST_CREDIT_AMOUNT || '50.00';

  // Ensure company/admin exists
  bootstrapCompany(baseUrl, adminApiKey);

  const adminTokens = login(baseUrl, { phoneOrEmail: adminEmail, password: adminPassword });

  // Ensure transfers are not blocked by downline constraints (useful for load testing).
  // WalletService reads this from AdminSetting.TRANSFER_TYPE and treats value as a mode string.
  http.post(`${baseUrl}/admin/settings/upsert`, JSON.stringify({ key: 'TRANSFER_TYPE', value: 'CROSSLINE' }), {
    headers: {
      'Content-Type': 'application/json',
      ...authCookieHeaders(adminTokens),
    },
  });

  // Ensure at least one supported external wallet type exists (used by external-wallet endpoints).
  let supportedWalletType = null;
  const supportedWalletsRes = http.get(`${baseUrl}/wallet/admin/supported-wallet-types`, {
    headers: authCookieHeaders(adminTokens),
  });

  if (supportedWalletsRes.status === 200) {
    const list = supportedWalletsRes.json();
    supportedWalletType = (list || []).find(
      (w) => w.name === 'USDT BEP20' && w.currency === 'USDT',
    );
  }

  if (!supportedWalletType) {
    const walletTypeRes = http.post(
      `${baseUrl}/wallet/admin/create-external-wallet-type`,
      JSON.stringify({ name: 'USDT BEP20', currency: 'USDT', allowedChangeCount: 3 }),
      {
        headers: {
          'Content-Type': 'application/json',
          ...authCookieHeaders(adminTokens),
        },
      },
    );
    if (walletTypeRes.status === 200 || walletTypeRes.status === 201) {
      try {
        supportedWalletType = walletTypeRes.json();
      } catch (e) {
        supportedWalletType = null;
      }
    }
  }

  const users = [];
  for (let i = 0; i < userCount; i++) {
    const dto = makeRegisterDto(i);
    const reg = registerUser(baseUrl, dto);
    users.push({
      id: reg.user.id,
      memberId: reg.user.memberId,
      email: dto.email,
      password: dto.password,
      tokens: reg.tokens,
    });

    // Credit the user's deposit wallet so financial endpoints (transfer/withdraw) have budget.
    http.post(
      `${baseUrl}/wallet/webhook/deposit`,
      JSON.stringify({
        userId: reg.user.id,
        amount: creditAmount,
        externalTxId: `loadtest_${i}_${Date.now()}`,
        meta: { source: 'k6' },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  return {
    baseUrl,
    admin: { tokens: adminTokens, email: adminEmail },
    supportedWalletType,
    users,
  };
}

export default function (ctx) {
  const baseUrl = ctx.baseUrl;
  const user = ctx.users[0];

  // Always validate basic wiring
  const resHealth = http.get(`${baseUrl}/health`);
  check(resHealth, { 'health is 200': (r) => r.status === 200 });

  const resMetrics = http.get(`${baseUrl}/metrics`);
  check(resMetrics, { 'metrics is 200': (r) => r.status === 200 });

  const resProfile = http.get(`${baseUrl}/auth/get-profile`, {
    headers: getAuthHeaderFromUser(ctx, 0),
  });
  check(resProfile, { 'get-profile is 200': (r) => r.status === 200 });

  // Full suite only once per k6 scenario (VU 1, iteration 0), and only when enabled.
  const fullSuiteEnabled = (__ENV.K6_FULL_SUITE || 'true') === 'true';
  if (!fullSuiteEnabled) return;

  function authHeadersForMode(mode) {
    if (mode === AuthMode.PUBLIC) return {};
    if (mode === AuthMode.ADMIN) return authCookieHeaders(ctx.admin.tokens);
    if (mode === AuthMode.USER) return authCookieHeaders(user.tokens);
    return {};
  }

  function call(endpoint, { pathParams = {}, body = null, query = {} } = {}) {
    let url = `${baseUrl}${resolvePath(endpoint.path, pathParams)}`;
    const qs = Object.entries(query || {})
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;

    const headers = {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeadersForMode(endpoint.auth),
    };

    const payload = body ? JSON.stringify(body) : null;
    const res = http.request(endpoint.method, url, payload, {
      headers,
      tags: { endpoint: endpoint.key },
      redirects: 0,
    });

    check(res, {
      [`${endpoint.key} status < 500`]: (r) => r.status < 500,
    });
    return res;
  }

  // --- On-demand "ensure" helpers (simple, best-effort) ---
  function ensureRankId() {
    if (ctx.rankId) return ctx.rankId;
    // Ranks are JWT-protected: use user cookie.
    const list = call({ ...endpointCatalog.find((e) => e.key === 'ranksList'), auth: AuthMode.USER }, {});
    const data = jsonOrNull(list) || [];
    if (Array.isArray(data) && data.length > 0 && data[0].id) {
      ctx.rankId = data[0].id;
      return ctx.rankId;
    }

    // Create a rank if none exists.
    const created = call(endpointCatalog.find((e) => e.key === 'adminCreateRank'), {
      body: {
        name: 'LT-Rank',
        requiredLeft: 10,
        requiredRight: 10,
        rewardAmount: 1,
        rewardTitle: 'Test Reward',
        order: 1,
      },
    });
    const createdBody = jsonOrNull(created);
    ctx.rankId = createdBody?.id || 1;
    return ctx.rankId;
  }

  function ensurePackageId() {
    if (ctx.packageId) return ctx.packageId;
    const listRes = call({ ...endpointCatalog.find((e) => e.key === 'packagesList'), auth: AuthMode.USER }, {});
    const list = jsonOrNull(listRes) || [];
    if (Array.isArray(list) && list.length > 0 && list[0].id) {
      ctx.packageId = list[0].id;
      return ctx.packageId;
    }

    const created = call(endpointCatalog.find((e) => e.key === 'packagesAdminCreate'), {
      body: {
        name: 'LT-Package',
        investmentMin: '10.00',
        investmentMax: '1000.00',
        dailyReturnPct: '1.00',
        durationDays: 14,
        capitalReturn: '0.00',
        isActive: true,
      },
    });
    const createdBody = jsonOrNull(created);
    ctx.packageId = createdBody?.id || 1;
    return ctx.packageId;
  }

  function ensureHolidayId() {
    if (ctx.holidayId) return ctx.holidayId;
    const listRes = call(endpointCatalog.find((e) => e.key === 'utilityHolidaysList'), {});
    const list = jsonOrNull(listRes) || [];
    if (Array.isArray(list) && list.length > 0 && list[0].id) {
      ctx.holidayId = list[0].id;
      return ctx.holidayId;
    }

    // Create a holiday for today+1 to avoid edge cases.
    const dt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const created = call(endpointCatalog.find((e) => e.key === 'utilityHolidaysCreate'), {
      body: { title: 'LT-Holiday', date: dt.toISOString(), type: 'TEST' },
    });
    const createdBody = jsonOrNull(created);
    ctx.holidayId = createdBody?.id || 1;
    return ctx.holidayId;
  }

  function createDepositRequest() {
    const amount = '5.00';
    const res = call(endpointCatalog.find((e) => e.key === 'walletDepositRequest'), {
      body: { amount, method: 'USDT', reference: `lt_${Date.now()}` },
    });
    const body = jsonOrNull(res);
    return body?.id;
  }

  function createWithdrawalRequest() {
    const amount = '1.00';
    // WalletController does not inject req.user.id into dto; it expects userId in the body.
    const res = call(endpointCatalog.find((e) => e.key === 'walletWithdraw'), {
      body: {
        userId: user.id,
        walletType: 'D_WALLET',
        amount,
        method: 'USDT_TRX',
        address: `T${Math.floor(Math.random() * 1e10)}`,
      },
    });
    const body = jsonOrNull(res);
    return body?.withdrawalId || body?.id;
  }

  function createExternalWallet() {
    if (ctx.userExternalWalletId) return ctx.userExternalWalletId;
    const supportedId = ctx.supportedWalletType?.id;
    if (!supportedId) return null;
    const res = call(endpointCatalog.find((e) => e.key === 'walletCreateExternalWallet'), {
      body: { supportedWalletId: supportedId, address: '0x' + Math.random().toString(16).slice(2, 10).padEnd(8, '0') },
    });
    const body = jsonOrNull(res);
    ctx.userExternalWalletId = body?.id;
    return ctx.userExternalWalletId;
  }

  function createQuery() {
    const msg = `LT-Query-${Date.now()}`;
    const res = call(endpointCatalog.find((e) => e.key === 'utilityQueriesCreate'), { body: { message: msg } });
    const body = jsonOrNull(res);
    ctx.queryId = body?.id;
    return ctx.queryId;
  }

  function ensureQueryId() {
    if (ctx.queryId) return ctx.queryId;
    // Try list first
    const listRes = call(endpointCatalog.find((e) => e.key === 'utilityQueriesList'), { query: { skip: 0, take: 20 } });
    const list = jsonOrNull(listRes) || [];
    if (Array.isArray(list) && list[0]?.id) {
      ctx.queryId = list[0].id;
      return ctx.queryId;
    }
    return createQuery();
  }

  function ensureNotificationId() {
    if (ctx.notificationId) return ctx.notificationId;
    const listRes = call(endpointCatalog.find((e) => e.key === 'notificationsGet'), { query: { take: 10, skip: 0 } });
    const list = jsonOrNull(listRes) || [];
    if (Array.isArray(list) && list[0]?.id) {
      ctx.notificationId = list[0].id;
      return ctx.notificationId;
    }
    return null;
  }

  // --- Full suite execution ---
  const nonDestructive = endpointCatalog.filter((e) => !e.destructive);
  const destructive = endpointCatalog.filter((e) => e.destructive);
  // Ensure pruneSystem is last among destructive endpoints.
  destructive.sort((a, b) => (a.key === 'adminPruneSystem' ? 1 : 0) - (b.key === 'adminPruneSystem' ? 1 : 0));

  function runWithKeyLogic(endpoint) {
    // Default call: no body, no path params
    let res = null;

    switch (endpoint.key) {
      case 'root':
      case 'health':
      case 'metrics':
      case 'swaggerUI':
      case 'swaggerJSON':
        res = call(endpoint);
        break;

      case 'authRegister': {
        const dto = makeRegisterDto(999 + Math.floor(Math.random() * 1000));
        res = call(endpoint, { body: dto });
        break;
      }

      case 'authLogin': {
        res = call(endpoint, { body: { phoneOrEmail: user.email, password: user.password } });
        break;
      }

      case 'authRefresh': {
        res = call(endpoint);
        break;
      }

      case 'authLogout':
        res = call(endpoint);
        break;

      case 'authChangeAvatar':
        res = call(endpoint, { body: { avatarId: 'default2' } });
        break;
      case 'authUpdateProfile':
        res = call(endpoint, { body: { firstName: 'LT', lastName: 'User', phoneNumber: '+15550001111', country: 'CA' } });
        break;
      case 'auth2faSetup':
        res = call(endpoint);
        break;
      case 'authGetProfile':
        res = call(endpoint);
        break;
      case 'authForgotPassword':
        res = call(endpoint, { body: { email: user.email } });
        break;
      case 'authResetPassword':
        // token is not returned by forgot-password; allow expected failure.
        res = call(endpoint, { body: { email: user.email, token: 'invalid', newPassword: 'NewPass_123!' } });
        break;
      case 'authRequest2faReset':
        res = call(endpoint, { body: { email: user.email, memberId: user.memberId } });
        break;
      case 'authRequest2faResetByAdmin':
        res = call(endpoint, { body: { email: user.email, memberId: user.memberId } });
        break;
      case 'authReset2fa':
        res = call(endpoint, { body: { email: user.email, token: 'invalid' } });
        break;

      case 'authAdminUsers2faReset':
        res = call(endpoint, { pathParams: { id: user.id } });
        break;
      case 'authAdminLoginForUser':
        res = call(endpoint, { body: { phoneOrEmail: user.email } });
        break;
      case 'authAdmin2faResetRequestsList':
        res = call(endpoint, { query: { page: 1, limit: 5 } });
        break;
      case 'authAdmin2faResetRequestsStatus': {
        // pick first request id from list (or create one via request-2fa-reset-by-admin)
        const listRes = call(endpointCatalog.find((e) => e.key === 'authAdmin2faResetRequestsList'), { query: { page: 1, limit: 20 } });
        const list = jsonOrNull(listRes) || [];
        const id = Array.isArray(list) ? list[0]?.id : list?.data?.[0]?.id;
        const status = 'APPROVED';
        if (id) {
          res = call(endpoint, { pathParams: { id }, body: { status } });
        } else {
          // fallback: create manual reset request first
          call(endpointCatalog.find((e) => e.key === 'authRequest2faResetByAdmin'), { body: { email: user.email, memberId: user.memberId } });
          const listRes2 = call(endpointCatalog.find((e) => e.key === 'authAdmin2faResetRequestsList'), { query: { page: 1, limit: 20 } });
          const list2 = jsonOrNull(listRes2) || [];
          const id2 = Array.isArray(list2) ? list2[0]?.id : list2?.data?.[0]?.id;
          res = call(endpoint, { pathParams: { id: id2 }, body: { status } });
        }
        break;
      }

      case 'adminUsersList':
        res = call(endpoint, { query: { take: 10, skip: 0, memberId: user.memberId } });
        break;
      case 'adminUsersSuspend':
      case 'adminUsersActivate':
      case 'adminUsersDisable2fa':
        res = call(endpoint, { pathParams: { userId: user.id } });
        break;

      case 'adminUsersRestrictWithdrawal':
        res = call(endpoint, { pathParams: { userId: user.id }, body: { restrict: true } });
        break;
      case 'adminUsersRestrictCrossLine':
        res = call(endpoint, { pathParams: { userId: user.id }, body: { restrict: true } });
        break;
      case 'adminUsersSetPassword':
        res = call(endpoint, { pathParams: { userId: user.id }, body: { password: 'LoadTest_Passw0rd!' } });
        break;
      case 'adminUsersProfile':
        res = call(endpoint, { pathParams: { userId: user.id }, body: { name: 'LT Updated', phone: '+15550002222' } });
        break;

      case 'adminBootstrapCompany':
        res = http.post(`${baseUrl}${endpoint.path}`, null, {
          headers: {
            'x-api-key': __ENV.ADMIN_API_KEY,
          },
          tags: { endpoint: endpoint.key },
          redirects: 0,
        });
        check(res, { [`${endpoint.key} status < 500`]: (r) => r.status < 500 });
        break;
      case 'adminWalletLimitsGet':
        res = call(endpoint);
        break;
      case 'adminWalletLimitsUpsert':
        res = call(endpoint, {
          body: {
            walletType: 'D_WALLET',
            minWithdrawal: '1.00',
            maxPerTx: '100.00',
            maxTxCount24h: 10,
            maxAmount24h: '500.00',
            isActive: true,
          },
        });
        break;
      case 'adminRunDailyReturns':
        res = call(endpoint);
        break;
      case 'adminPruneSystem':
        res = call(endpoint, { body: { confirm: 'PRUNE' } });
        break;
      case 'adminSettingsUpsert':
        res = call(endpoint, { body: { key: 'TRANSFER_TYPE', value: 'CROSSLINE' } });
        break;
      case 'adminSettingsGet':
        res = call(endpoint, { query: { key: 'TRANSFER_TYPE' } });
        break;
      case 'adminExportUserData':
        res = call(endpoint);
        break;

      case 'adminCreateRank':
        res = call(endpoint, {
          body: { name: 'LT-Rank', requiredLeft: 10, requiredRight: 10, rewardAmount: 1, rewardTitle: 'Test Reward', order: 1 },
        });
        break;
      case 'adminUpdateRank':
        res = call(endpoint, { pathParams: { id: ensureRankId() }, body: { name: 'LT-Rank', requiredLeft: 20, requiredRight: 20, rewardAmount: 1, order: 1 } });
        break;
      case 'adminDeleteRank':
        res = call(endpoint, { pathParams: { id: ensureRankId() } });
        break;

      case 'adminStats':
      case 'adminWalletLimitsGet':
      case 'adminDepositBonusList':
      case 'adminSettingsGet':
        res = call(endpoint);
        break;

      case 'adminDepositBonusCreate':
        res = call(endpoint, {
          body: {
            bonusPercentage: 10,
            startDate: new Date(Date.now()).toISOString(),
            endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          },
        });
        break;
      case 'adminDepositBonusUpdate': {
        const bonusId =
          ctx.depositBonusId ||
          (() => {
            const r = call(endpointCatalog.find((e) => e.key === 'adminDepositBonusList'));
            const list = jsonOrNull(r) || [];
            return list?.[0]?.id;
          })();
        ctx.depositBonusId = bonusId;
        res = call(endpoint, {
          pathParams: { id: bonusId },
          body: { bonusPercentage: 15 },
        });
        break;
      }
      case 'adminDepositBonusDelete': {
        const bonusId =
          ctx.depositBonusId ||
          (() => {
            const r = call(endpointCatalog.find((e) => e.key === 'adminDepositBonusList'));
            const list = jsonOrNull(r) || [];
            return list?.[0]?.id;
          })();
        res = call(endpoint, { pathParams: { id: bonusId } });
        break;
      }

      // Wallet user endpoints
      case 'walletUserWallets':
      case 'walletIncomeBinary':
      case 'walletIncomeDirect':
      case 'walletIncomeReferral':
      case 'walletIncomeGainReport':
        res = call(endpoint, { query: { type: 'BINARY_INCOME', skip: 0, take: 10, self: 'no' } });
        break;
      case 'walletDepositHistory':
      case 'walletWithdrawalRequestsList':
      case 'walletListMyExternalWallets':
        res = call(endpoint);
        break;

      case 'walletTransfer': {
        const recipient = ctx.users[1] || ctx.users[0];
        res = call(endpoint, {
          body: { fromWalletType: 'D_WALLET', toMemberId: recipient.memberId, amount: '1.00' },
        });
        break;
      }

      case 'walletInternalTransfer':
        // Service returns "disabled" (but should still be 200).
        res = call(endpoint, {
          body: { fromWalletType: 'D_WALLET', toWalletType: 'P_WALLET', amount: '1.00' },
        });
        break;

      case 'walletWithdraw': {
        res = call(endpoint, {
          body: {
            userId: user.id,
            walletType: 'D_WALLET',
            amount: '1.00',
            method: 'USDT_TRX',
            address: `T${Math.floor(Math.random() * 1e10)}`,
          },
        });
        break;
      }

      case 'walletWebhookDeposit':
        // Credits D_WALLET; no auth required.
        res = call(endpoint, {
          body: { userId: user.id, amount: '1.00', externalTxId: `ipn_${Date.now()}`, meta: { source: 'k6' } },
        });
        break;

      case 'walletDepositRequest':
        res = call(endpoint, { body: { amount: '5.00', method: 'USDT', reference: `lt_${Date.now()}` } });
        break;

      case 'walletDepositRequestsList':
        res = call(endpoint, { body: { skip: 0, take: 10, status: 'PENDING' } });
        break;

      case 'walletCryptoDeposit': {
        res = call(endpoint, { body: { amount: '10.00', crypto: 'USDTTRC20' } });
        ctx.cryptoDepositId = jsonOrNull(res)?.depositId;
        break;
      }
      case 'walletDepositStatus': {
        // If ctx has depositStatusId, use it; else create a deposit request and try listing status.
        if (!ctx.depositStatusId) {
          if (__ENV.NOWPAYMENTS_BASE && __ENV.NOWPAYMENTS_API_KEY) {
            const depRes = call(endpointCatalog.find((e) => e.key === 'walletCryptoDeposit'), {
              body: { amount: '10.00', crypto: 'USDTTRC20' },
            });
            const body = jsonOrNull(depRes);
            ctx.depositStatusId = body?.depositId;
          }
        }
        res = call(endpoint, { pathParams: { id: ctx.depositStatusId || 1 } });
        break;
      }

      case 'walletWithdrawalCancel': {
        const withdrawalId = createWithdrawalRequest();
        res = call(endpoint, { pathParams: { id: withdrawalId } });
        break;
      }

      case 'walletTransactions':
        res = call(endpoint, {
          body: { walletType: 'D_WALLET', skip: 0, take: 5, filters: {} },
        });
        break;

      case 'walletCreateExternalWallet': {
        const supportedId = ctx.supportedWalletType?.id;
        res = call(endpoint, {
          body: { supportedWalletId: supportedId, address: '0x' + Math.random().toString(16).slice(2, 10).padEnd(8, '0') },
        });
        const body = jsonOrNull(res);
        ctx.userExternalWalletId = body?.id;
        break;
      }
      case 'walletUpdateExternalWallet':
        if (!createExternalWallet()) break;
        res = call(endpoint, {
          pathParams: { walletId: ctx.userExternalWalletId },
          body: { address: '0x' + Math.random().toString(16).slice(2, 10).padEnd(8, '0') },
        });
        break;
      case 'walletDeleteExternalWallet':
        if (!createExternalWallet()) break;
        res = call(endpoint, { pathParams: { walletId: ctx.userExternalWalletId } });
        break;

      // Wallet admin endpoints
      case 'walletAdminSupportedWalletTypes':
        res = call(endpoint);
        break;
      case 'walletAdminCreateExternalWalletType':
        if (!ctx.supportedWalletType?.id) {
          res = call(endpoint, {
            body: { name: 'USDT BEP20', currency: 'USDT', allowedChangeCount: 3 },
          });
        }
        break;
      case 'walletAdminUpdateExternalWalletType': {
        const sid = ctx.supportedWalletType?.id;
        if (!sid) {
          break;
        }
        res = call(endpoint, {
          pathParams: { id: sid },
          body: { name: 'USDT BEP20', currency: 'USDT', allowedChangeCount: 3 },
        });
        break;
      }
      case 'walletAdminDeleteExternalWalletTypeWeirdDot': {
        const sid = ctx.supportedWalletType?.id;
        if (!sid) break;
        res = call(endpoint, { pathParams: { id: sid } });
        break;
      }
      case 'walletAdminOverrideExternalWallet': {
        const walletId = ctx.userExternalWalletId || createExternalWallet();
        if (!walletId) break;
        res = call(endpoint, {
          pathParams: { walletId },
          body: { address: '0x' + Math.random().toString(16).slice(2, 10).padEnd(8, '0') },
        });
        break;
      }
      case 'walletAdminDeposits':
        res = call(endpoint);
        break;
      case 'walletAdminDepositById': {
        // Best-effort: if we have an external deposit id, use it; otherwise we try to create one.
        if (!ctx.cryptoDepositId) {
          if (__ENV.NOWPAYMENTS_BASE && __ENV.NOWPAYMENTS_API_KEY) {
            const depRes = call(endpointCatalog.find((e) => e.key === 'walletCryptoDeposit'), {
              body: { amount: '10.00', crypto: 'USDTTRC20' },
            });
            const depBody = jsonOrNull(depRes);
            ctx.cryptoDepositId = depBody?.depositId;
          }
        }
        res = call(endpoint, { pathParams: { id: ctx.cryptoDepositId || 1 } });
        break;
      }

      case 'walletAdminDepositsApprove': {
        const depositRequestId = createDepositRequest();
        res = call(endpoint, { pathParams: { id: depositRequestId }, body: undefined });
        break;
      }
      case 'walletAdminDepositsReject': {
        const depositRequestId = createDepositRequest();
        res = call(endpoint, { pathParams: { id: depositRequestId } });
        break;
      }

      case 'walletAdminWithdrawalsApprove': {
        const withdrawalId = createWithdrawalRequest();
        res = call(endpoint, { pathParams: { id: withdrawalId }, body: { adminNote: 'LT approve' } });
        break;
      }
      case 'walletAdminWithdrawalsReject': {
        const withdrawalId = createWithdrawalRequest();
        res = call(endpoint, { pathParams: { id: withdrawalId }, body: { adminNote: 'LT reject' } });
        break;
      }
      case 'walletAdminBonusCredit':
        res = call(endpoint, { body: { userId: user.id, amount: '1.00', reason: 'LT bonus' } });
        break;

      // Packages
      case 'packagesAdminCreate':
        res = call(endpoint, {
          body: { name: 'LT-Package', investmentMin: '10.00', investmentMax: '1000.00', dailyReturnPct: '1.00', durationDays: 14, capitalReturn: '0.00', isActive: true },
        });
        ctx.packageId = jsonOrNull(res)?.id;
        break;
      case 'packagesAdminUpdate': {
        const pid = ensurePackageId();
        res = call(endpoint, { pathParams: { id: pid }, body: { isActive: true } });
        break;
      }
      case 'packagesList':
      case 'packagesMy':
      case 'packagesWalletRulesGet':
        res = call(endpoint);
        break;
      case 'packagesPurchase': {
        const pid = ensurePackageId();
        // Use 100% from D_WALLET since setup credits that wallet.
        res = call(endpoint, {
          body: {
            packageId: pid,
            amount: '10.00',
            split: { D_WALLET: 100 },
            isTarget: false,
          },
        });
        break;
      }
      case 'packagesWalletRulesUpsert':
        res = call(endpoint, { body: { wallet: 'D_WALLET', minPct: '0.00' } });
        break;

      // Utility
      case 'utilityQueriesCreate':
        res = call(endpoint, { body: { message: `LT query ${Date.now()}` } });
        ctx.queryId = jsonOrNull(res)?.id;
        break;
      case 'utilityQueriesReply': {
        const qid = ensureQueryId();
        res = call(endpoint, { pathParams: { id: qid }, body: { message: 'LT admin reply' } });
        break;
      }
      case 'utilityQueriesList':
      case 'utilityAdminQueriesList':
      case 'utilityHolidaysList':
        res = call(endpoint, { query: { skip: 0, take: 20 } });
        break;
      case 'utilityHolidaysCreate': {
        // createHoliday needs title/date/type; date expects a string parseable by new Date()
        const dt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        res = call(endpoint, { body: { title: 'LT Holiday', date: dt, type: 'TEST' } });
        ctx.holidayId = jsonOrNull(res)?.id;
        break;
      }
      case 'utilityHolidaysUpdate': {
        const hid = ensureHolidayId();
        res = call(endpoint, { pathParams: { id: hid }, body: { title: 'LT Holiday Updated' } });
        break;
      }
      case 'utilityHolidaysDelete': {
        const hid = ensureHolidayId();
        res = call(endpoint, { pathParams: { id: hid } });
        break;
      }

      // Targets
      case 'targetsAdminList':
      case 'targetsAdminAssign':
      case 'targetsAdminUpdate':
      case 'targetsAdminDelete':
      case 'targetsStats':
      case 'targetsBusinessVolume':
      case 'targetsMy':
        // best-effort: attempt list, then create/patch with minimal DTOs.
        if (endpoint.key === 'targetsMy') {
          res = call(endpoint);
        } else if (endpoint.key === 'targetsAdminAssign') {
          res = call(endpoint, {
            body: {
              memberId: user.memberId,
              split: { D_WALLET: 100 },
              packageAmount: '10.00',
              targetMultiplier: 'X1',
              targetType: 'DIRECT',
              targetNeededToUnlockDailyRoi: '10.00',
            },
          });
        } else if (endpoint.key === 'targetsAdminUpdate') {
          const listRes = call(endpointCatalog.find((e) => e.key === 'targetsAdminList'));
          const list = jsonOrNull(listRes) || [];
          const tid = list?.[0]?.id;
          res = call(endpoint, { pathParams: { id: tid }, body: { multiplier: 'X1', salesType: 'DIRECT', targetAmount: '10.00' } });
        } else if (endpoint.key === 'targetsAdminDelete') {
          const listRes = call(endpointCatalog.find((e) => e.key === 'targetsAdminList'));
          const list = jsonOrNull(listRes) || [];
          const tid = list?.[0]?.id;
          res = call(endpoint, { pathParams: { id: tid } });
        } else {
          res = call(endpoint);
        }
        break;

      // Tree
      case 'treeUser':
        res = call(endpoint, { pathParams: { id: 1 } });
        break;
      case 'treeDownlineRecent':
      case 'treeReferrals':
      case 'treeDownlineRank':
      case 'treeDownlineDepositFunds':
        res = call(endpoint, { query: { limit: 5, page: 1, pageSize: 10 } });
        break;
      case 'treeSearchMember':
        res = call(endpoint, { query: { rootUserId: 1, memberId: user.memberId } });
        break;
      case 'treeSearchExtremeLeft':
        res = call(endpoint, { query: { rootUserId: 1 } });
        break;
      case 'treeSearchExtremeRight':
        res = call(endpoint, { query: { rootUserId: 1 } });
        break;

      // Ranks
      case 'ranksList':
      case 'ranksUser':
      case 'ranksProgress':
        res = call(endpoint);
        break;
      case 'ranksClaim':
        res = call(endpoint, { pathParams: { rankId: ensureRankId() } });
        break;

      // Notifications
      case 'notificationsGet':
        res = call(endpoint, { query: { take: 10, skip: 0 } });
        break;
      case 'notificationsMarkRead': {
        const nid = ensureNotificationId();
        if (nid) res = call(endpoint, { pathParams: { id: nid } });
        else res = call(endpoint, { pathParams: { id: 1 } });
        break;
      }
      case 'notificationsReadAll':
        res = call(endpoint);
        break;

      // Payments IPN: requires NOWPAYMENTS signature; best-effort call
      case 'paymentsIpn': {
        const nowSecret = __ENV.NOWPAYMENTS_IPN_SECRET || 'default_secret';
        // NOTE: Computing sha512 HMAC in k6 needs a crypto helper; to keep this scaffold safe,
        // we send no signature if not configured (endpoint will likely 401).
        const sig = '';
        res = http.post(`${baseUrl}${endpoint.path}`, JSON.stringify({ payment_id: '0', payment_status: 'failed', actually_paid: '0', pay_currency: 'USDT' }), {
          headers: { 'Content-Type': 'application/json', 'x-nowpayments-sig': sig },
          tags: { endpoint: endpoint.key },
          redirects: 0,
        });
        check(res, { [`${endpoint.key} status < 500`]: (r) => r.status < 500 });
        break;
      }

      default:
        // Generic best-effort: if endpoint expects a body, set empty object.
        res = call(endpoint);
        break;
    }
    return res;
  }

  for (const endpoint of nonDestructive) {
    // Skip endpoints that are known to be impossible without extra secrets/state.
    // This keeps the run from failing hard on missing external integrations.
    if (endpoint.key === 'walletCryptoDeposit' && (!__ENV.NOWPAYMENTS_BASE || !__ENV.NOWPAYMENTS_API_KEY)) {
      continue;
    }
    if (endpoint.key === 'paymentsIpn' && !__ENV.NOWPAYMENTS_IPN_SECRET) {
      continue;
    }
    runWithKeyLogic(endpoint);
  }
  for (const endpoint of destructive) {
    runWithKeyLogic(endpoint);
  }
}

