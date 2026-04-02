import http from 'k6/http';
import { check, fail } from 'k6';

function getCookieValue(res, cookieName) {
  // k6 sets a `cookies` map for Set-Cookie values (when supported by the runtime)
  if (res && res.cookies && res.cookies[cookieName] && res.cookies[cookieName].value) {
    return res.cookies[cookieName].value;
  }

  // Fallback: parse Set-Cookie header(s)
  const headers = res?.headers || {};
  const setCookie =
    headers['Set-Cookie'] ||
    headers['set-cookie'] ||
    headers['SET-COOKIE'] ||
    undefined;

  if (!setCookie) return undefined;

  const headerStr = Array.isArray(setCookie) ? setCookie.join(',') : setCookie;
  const idx = headerStr.indexOf(`${cookieName}=`);
  if (idx === -1) return undefined;

  const after = headerStr.slice(idx + `${cookieName}=`.length);
  return after.split(';')[0].trim();
}

export function cookieHeader(tokens) {
  const parts = [];
  if (tokens?.accessToken) parts.push(`access_token=${tokens.accessToken}`);
  if (tokens?.refreshToken) parts.push(`refresh_token=${tokens.refreshToken}`);
  return parts.join('; ');
}

/** Cookie + X-CSRF-Token when the server issues CSRF_PROTECTION (double-submit cookie). */
export function authCookieHeaders(tokens) {
  if (!tokens?.accessToken && !tokens?.refreshToken) return {};
  const h = { Cookie: cookieHeader(tokens) };
  if (tokens.csrfToken) {
    h['X-CSRF-Token'] = tokens.csrfToken;
  }
  return h;
}

export function cookieTokensFromResponse(res) {
  return {
    accessToken: getCookieValue(res, 'access_token'),
    refreshToken: getCookieValue(res, 'refresh_token'),
    csrfToken: getCookieValue(res, 'csrf_token'),
  };
}

export function bootstrapCompany(baseUrl, adminApiKey) {
  const url = `${baseUrl}/admin/bootstrap/company`;
  const res = http.post(url, null, {
    headers: {
      'x-api-key': adminApiKey,
    },
  });

  check(res, {
    'bootstrap/company status is 200/201': (r) => r.status === 200 || r.status === 201,
  });

  if (res.status !== 200 && res.status !== 201) {
    fail(`bootstrap/company failed: status=${res.status} body=${res.body?.slice(0, 400)}`);
  }
  return res.json();
}

export function login(baseUrl, { phoneOrEmail, password }) {
  const url = `${baseUrl}/auth/login`;
  const res = http.post(url, JSON.stringify({ phoneOrEmail, password }), {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  check(res, {
    'login status is 200': (r) => r.status === 200,
  });
  if (res.status !== 200) {
    fail(`login failed: status=${res.status} body=${res.body?.slice(0, 400)}`);
  }

  const tokens = cookieTokensFromResponse(res);
  if (!tokens.accessToken || !tokens.refreshToken) {
    fail(`login succeeded but cookies missing (access_token or refresh_token). Received: ${JSON.stringify(tokens)}`);
  }
  return tokens;
}

export function registerUser(baseUrl, dto) {
  const url = `${baseUrl}/auth/register`;
  const res = http.post(url, JSON.stringify(dto), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'register status is 200/201': (r) => r.status === 200 || r.status === 201,
  });
  if (res.status !== 200 && res.status !== 201) {
    fail(`register failed: status=${res.status} body=${res.body?.slice(0, 400)}`);
  }

  const tokens = cookieTokensFromResponse(res);
  if (!tokens.accessToken || !tokens.refreshToken) {
    fail(`register succeeded but cookies missing (access_token or refresh_token). Received: ${JSON.stringify(tokens)}`);
  }

  const body = res.json();
  return { user: body, tokens };
}

