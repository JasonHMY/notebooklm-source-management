#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');
const TOKENS_PATH = path.join(ROOT, 'tokens.json');
const LAST_AUTH_URL_PATH = path.join(ROOT, 'last-auth-url.txt');
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:3000/callback';
const DEFAULT_SCOPES = 'tweet.read users.read tweet.write offline.access';

function loadEnv() {
  const env = { ...process.env };
  if (!fs.existsSync(ENV_PATH)) return env;

  const text = fs.readFileSync(ENV_PATH, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) return;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  });
  return env;
}

function requireEnv(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env values in ${ENV_PATH}: ${missing.join(', ')}`);
  }
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function tokenRequestHeaders(env) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  if (env.X_CLIENT_SECRET) {
    const credentials = Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  }
  return headers;
}

async function requestToken(env, params) {
  const body = new URLSearchParams(params);
  if (!env.X_CLIENT_SECRET && !body.has('client_id')) {
    body.set('client_id', env.X_CLIENT_ID);
  }

  const response = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: tokenRequestHeaders(env),
    body
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Token request failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

function saveTokens(tokens) {
  const expiresInSeconds = Number(tokens.expires_in || 0);
  const saved = {
    ...tokens,
    expires_at: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null,
    saved_at: new Date().toISOString()
  };
  fs.writeFileSync(TOKENS_PATH, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(TOKENS_PATH, 0o600);
  } catch (error) {
    // Best effort on platforms that do not support chmod.
  }
  return saved;
}

function loadTokens() {
  if (!fs.existsSync(TOKENS_PATH)) {
    throw new Error(`Missing ${TOKENS_PATH}. Run: node x-auth.js auth`);
  }
  return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
}

function tokensExpireSoon(tokens) {
  if (!tokens.expires_at) return false;
  return Date.parse(tokens.expires_at) - Date.now() < 5 * 60 * 1000;
}

async function refreshTokens(env, tokens = loadTokens()) {
  if (!tokens.refresh_token) {
    throw new Error('No refresh_token available. Re-run: node x-auth.js auth');
  }
  const refreshed = await requestToken(env, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: env.X_CLIENT_ID
  });
  return saveTokens({
    ...tokens,
    ...refreshed,
    refresh_token: refreshed.refresh_token || tokens.refresh_token
  });
}

async function getUsableTokens(env) {
  const tokens = loadTokens();
  if (tokensExpireSoon(tokens)) {
    return refreshTokens(env, tokens);
  }
  return tokens;
}

async function getMe(accessToken) {
  const response = await fetch('https://api.x.com/2/users/me?user.fields=username,name,verified,created_at', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Account check failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function auth() {
  const env = loadEnv();
  requireEnv(env, ['X_CLIENT_ID']);
  const redirectUri = env.X_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const scopes = env.X_OAUTH_SCOPES || DEFAULT_SCOPES;
  const redirect = new URL(redirectUri);
  const port = Number(redirect.port || (redirect.protocol === 'https:' ? 443 : 80));
  const { verifier, challenge } = createPkcePair();
  const state = base64Url(crypto.randomBytes(24));

  const authorizeUrl = new URL('https://x.com/i/oauth2/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', env.X_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', scopes);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  fs.writeFileSync(LAST_AUTH_URL_PATH, `${authorizeUrl.toString()}\n`);
  console.log('Open this URL in your browser and approve the app:');
  console.log(authorizeUrl.toString());
  console.log('');
  console.log(`Waiting for callback on ${redirectUri} ...`);

  await new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url, redirectUri);
        if (requestUrl.pathname !== redirect.pathname) {
          response.writeHead(404, { 'Content-Type': 'text/plain' });
          response.end('Not found');
          return;
        }

        const error = requestUrl.searchParams.get('error');
        if (error) {
          throw new Error(`Authorization denied: ${error}`);
        }

        const receivedState = requestUrl.searchParams.get('state');
        const code = requestUrl.searchParams.get('code');
        if (!code) throw new Error('Callback is missing code');
        if (receivedState !== state) throw new Error('OAuth state mismatch');

        const tokenPayload = await requestToken(env, {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
          client_id: env.X_CLIENT_ID
        });
        const saved = saveTokens(tokenPayload);
        const me = await getMe(saved.access_token);

        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(`X authorization saved for @${me.data.username}. You can close this tab.\n`);
        console.log(`Authorization saved for @${me.data.username} (${me.data.id}).`);
        console.log(`Tokens saved to ${TOKENS_PATH}.`);
        server.close(resolve);
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(`${error.message}\n`);
        server.close(() => reject(error));
      }
    });

    server.on('error', reject);
    server.listen(port, redirect.hostname);
  });
}

async function me() {
  const env = loadEnv();
  requireEnv(env, ['X_CLIENT_ID']);
  const tokens = await getUsableTokens(env);
  const payload = await getMe(tokens.access_token);
  console.log(JSON.stringify(payload, null, 2));
}

async function refresh() {
  const env = loadEnv();
  requireEnv(env, ['X_CLIENT_ID']);
  const tokens = await refreshTokens(env);
  console.log(`Refreshed token. Expires at: ${tokens.expires_at || 'unknown'}`);
}

async function importTokens() {
  const env = loadEnv();
  requireEnv(env, ['X_ACCESS_TOKEN', 'X_REFRESH_TOKEN']);
  const saved = saveTokens({
    token_type: 'bearer',
    access_token: env.X_ACCESS_TOKEN,
    refresh_token: env.X_REFRESH_TOKEN,
    scope: env.X_OAUTH_SCOPES || DEFAULT_SCOPES,
    expires_in: 2 * 60 * 60
  });
  const payload = await getMe(saved.access_token);
  console.log(`Imported tokens for @${payload.data.username} (${payload.data.id}).`);
  console.log(`Tokens saved to ${TOKENS_PATH}.`);
}

async function main() {
  const command = process.argv[2];
  if (command === 'auth') return auth();
  if (command === 'me') return me();
  if (command === 'refresh') return refresh();
  if (command === 'import') return importTokens();
  console.log('Usage: node x-auth.js <auth|me|refresh|import>');
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_SCOPES,
  getMe,
  getUsableTokens,
  loadEnv,
  loadTokens,
  refreshTokens
};
