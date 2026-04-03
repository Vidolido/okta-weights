/**
 * OKTA API Client — with heavy diagnostic logging
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

let apiConfig = null;

function getApiConfig() {
    if (apiConfig) return apiConfig;
    const raw = fs.readFileSync(path.resolve(__dirname, '..', 'config.json'), 'utf8');
    const config = JSON.parse(raw);
    apiConfig = config.api || {};
    return apiConfig;
}

let cachedToken = null;

/**
 * Authenticate against the OKTA API.
 */
async function authenticate() {
    const cfg = getApiConfig();
    const url = cfg.baseUrl + 'open-api/auth';

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║              API AUTHENTICATION                  ║');
    console.log('╚══════════════════════════════════════════════════╝');

    console.log('[AUTH] Config baseUrl:', JSON.stringify(cfg.baseUrl));
    console.log('[AUTH] Config baseUrl type:', typeof cfg.baseUrl);
    console.log('[AUTH] Config baseUrl length:', cfg.baseUrl ? cfg.baseUrl.length : 0);
    console.log('[AUTH] Config baseUrl chars:', cfg.baseUrl ? cfg.baseUrl.split('').map(function(c) { return c.charCodeAt(0); }).join(',') : 'empty');
    console.log('[AUTH] Full auth URL:', JSON.stringify(url));
    console.log('[AUTH] URL breakdown:');
    try {
        var parsed = new URL(url);
        console.log('[AUTH]   protocol:', parsed.protocol);
        console.log('[AUTH]   hostname:', parsed.hostname);
        console.log('[AUTH]   port:', parsed.port || '(default)');
        console.log('[AUTH]   pathname:', parsed.pathname);
        console.log('[AUTH]   full href:', parsed.href);
    } catch(e) {
        console.log('[AUTH]   URL PARSE ERROR:', e.message);
    }

    console.log('[AUTH] ApiKey:', JSON.stringify(String(cfg.apiKey)));
    console.log('[AUTH] ClientId:', JSON.stringify(cfg.clientId));
    console.log('[AUTH] ClientSecretHash (first 20):', cfg.clientSecretHash ? cfg.clientSecretHash.substring(0, 20) + '...' : 'NOT SET');
    console.log('[AUTH] Request timeout:', cfg.requestTimeout || 30000, 'ms');

    var requestBody = {
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecretHash,
    };
    var requestHeaders = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': String(cfg.apiKey),
    };

    console.log('');
    console.log('[AUTH] --- SENDING REQUEST ---');
    console.log('[AUTH] Method: POST');
    console.log('[AUTH] URL:', url);
    console.log('[AUTH] Headers:', JSON.stringify(requestHeaders, null, 2));
    console.log('[AUTH] Body:', JSON.stringify(requestBody, null, 2));
    console.log('[AUTH] Sending at:', new Date().toISOString());

    var startTime = Date.now();

    try {
        const response = await axios.request({
            method: 'POST',
            url: url,
            headers: requestHeaders,
            data: requestBody,
            timeout: cfg.requestTimeout || 30000,
            // Prevent axios from throwing on non-2xx so we can log everything
            validateStatus: function () { return true; },
            // Log the actual request axios makes
            transformRequest: [function (data, headers) {
                console.log('[AUTH] Axios internal - Content-Type being sent:', headers['Content-Type']);
                console.log('[AUTH] Axios internal - Data type:', typeof data);
                return data;
            }],
        });

        var elapsed = Date.now() - startTime;
        console.log('');
        console.log('[AUTH] --- RESPONSE RECEIVED ---');
        console.log('[AUTH] Time elapsed:', elapsed, 'ms');
        console.log('[AUTH] HTTP status:', response.status, response.statusText);
        console.log('[AUTH] Response headers:', JSON.stringify(response.headers, null, 2));

        var rawBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        console.log('[AUTH] Response body (first 500 chars):', rawBody.substring(0, 500));
        console.log('[AUTH] Response body length:', rawBody.length);
        console.log('[AUTH] Response data type:', typeof response.data);

        if (response.status >= 400) {
            console.log('[AUTH] ✗ Auth failed with HTTP', response.status);
            throw new Error('Auth failed with HTTP ' + response.status + ': ' + rawBody.substring(0, 200));
        }

        // The token might come back in various formats
        let token = response.data;

        if (typeof token === 'string' && token.startsWith('"') && token.endsWith('"')) {
            console.log('[AUTH] Token is quoted string, unwrapping...');
            token = JSON.parse(token);
        }

        if (typeof token === 'object' && token !== null) {
            console.log('[AUTH] Token is object, keys:', Object.keys(token));
            if (token.token) token = token.token;
            else if (token.access_token) token = token.access_token;
            else {
                console.log('[AUTH] No known token property, trying first string value');
                for (var k of Object.keys(token)) {
                    if (typeof token[k] === 'string' && token[k].length > 10) {
                        token = token[k];
                        break;
                    }
                }
            }
        }

        cachedToken = String(token);
        console.log('');
        console.log('[AUTH] ✓ TOKEN RECEIVED');
        console.log('[AUTH] Token type:', typeof cachedToken);
        console.log('[AUTH] Token length:', cachedToken.length);
        console.log('[AUTH] Token first 40 chars:', cachedToken.substring(0, 40));
        console.log('[AUTH] Token last 10 chars:', cachedToken.substring(cachedToken.length - 10));
        console.log('');

        return cachedToken;

    } catch (err) {
        var elapsed = Date.now() - startTime;
        console.log('');
        console.log('[AUTH] ✗ AUTH FAILED after', elapsed, 'ms');
        console.log('[AUTH] Error name:', err.name);
        console.log('[AUTH] Error message:', err.message);
        console.log('[AUTH] Error code:', err.code || 'N/A');
        if (err.config) {
            console.log('[AUTH] Axios attempted URL:', err.config.url);
            console.log('[AUTH] Axios attempted method:', err.config.method);
            // Show what axios actually resolved
            if (err.config.baseURL) console.log('[AUTH] Axios baseURL:', err.config.baseURL);
        }
        if (err.request) {
            console.log('[AUTH] Request was made but no response received');
            console.log('[AUTH] Request socket?', err.request.socket ? 'yes' : 'no');
            if (err.request.socket) {
                console.log('[AUTH] Remote address:', err.request.socket.remoteAddress);
                console.log('[AUTH] Remote port:', err.request.socket.remotePort);
                console.log('[AUTH] Remote family:', err.request.socket.remoteFamily);
            }
        }
        if (err.response) {
            console.log('[AUTH] Response received but status was error:', err.response.status);
        }
        console.log('[AUTH] Full error stack:', err.stack);
        console.log('');
        throw err;
    }
}

/**
 * Fetch sessions modified since a given date.
 */
async function getSessions(modFrom) {
    const cfg = getApiConfig();
    const token = await ensureToken();
    const url = cfg.baseUrl + 'open-api/sessions?modFrom=' + encodeURIComponent(modFrom);

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║              FETCH SESSIONS                      ║');
    console.log('╚══════════════════════════════════════════════════╝');

    console.log('[SESSIONS] URL:', url);
    try {
        var parsed = new URL(url);
        console.log('[SESSIONS]   hostname:', parsed.hostname);
        console.log('[SESSIONS]   port:', parsed.port || '(default)');
        console.log('[SESSIONS]   pathname:', parsed.pathname);
        console.log('[SESSIONS]   search:', parsed.search);
    } catch(e) {
        console.log('[SESSIONS]   URL PARSE ERROR:', e.message);
    }
    console.log('[SESSIONS] modFrom:', modFrom);
    console.log('[SESSIONS] Token (first 30):', String(token).substring(0, 30) + '...');
    console.log('[SESSIONS] ApiKey:', JSON.stringify(String(cfg.apiKey)));

    var requestHeaders = {
        'Accept': 'application/json',
        'X-Api-Key': String(cfg.apiKey),
        'Authorization': 'Bearer ' + token,
    };
    console.log('[SESSIONS] Headers:', JSON.stringify(requestHeaders, null, 2));
    console.log('[SESSIONS] Sending at:', new Date().toISOString());

    var startTime = Date.now();

    try {
        const response = await axios.get(url, {
            headers: requestHeaders,
            timeout: cfg.requestTimeout || 30000,
            validateStatus: function () { return true; },
        });

        var elapsed = Date.now() - startTime;
        console.log('');
        console.log('[SESSIONS] --- RESPONSE ---');
        console.log('[SESSIONS] Time:', elapsed, 'ms');
        console.log('[SESSIONS] HTTP status:', response.status, response.statusText);
        console.log('[SESSIONS] Response headers:', JSON.stringify(response.headers, null, 2));

        var rawBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        console.log('[SESSIONS] Body (first 500 chars):', rawBody.substring(0, 500));
        console.log('[SESSIONS] Body length:', rawBody.length);

        if (response.status >= 400) {
            console.log('[SESSIONS] ✗ Sessions request failed with HTTP', response.status);
            throw new Error('Sessions failed with HTTP ' + response.status + ': ' + rawBody.substring(0, 200));
        }

        const sessions = response.data;
        const count = Array.isArray(sessions) ? sessions.length : 'NOT AN ARRAY';
        console.log('[SESSIONS] Session count:', count);

        if (count > 0 && count !== 'NOT AN ARRAY') {
            console.log('[SESSIONS] First session:', JSON.stringify(sessions[0]).substring(0, 500));
        }

        console.log('[SESSIONS] ✓ Done');
        console.log('');
        return Array.isArray(sessions) ? sessions : [];

    } catch (err) {
        var elapsed = Date.now() - startTime;
        console.log('');
        console.log('[SESSIONS] ✗ FAILED after', elapsed, 'ms');
        console.log('[SESSIONS] Error:', err.message);
        console.log('[SESSIONS] Code:', err.code || 'N/A');
        if (err.config) console.log('[SESSIONS] URL attempted:', err.config.url);
        if (err.request && err.request.socket) {
            console.log('[SESSIONS] Remote:', err.request.socket.remoteAddress + ':' + err.request.socket.remotePort);
        }
        console.log('[SESSIONS] Stack:', err.stack);
        console.log('');
        throw err;
    }
}

/**
 * Fetch events for a specific session.
 */
async function getSessionEvents(sessionId) {
    const cfg = getApiConfig();
    const token = await ensureToken();
    const url = cfg.baseUrl + 'open-api/session/events?parent_id=' + encodeURIComponent(String(sessionId));

    var startTime = Date.now();

    try {
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/json',
                'X-Api-Key': String(cfg.apiKey),
                'Authorization': 'Bearer ' + token,
            },
            timeout: cfg.requestTimeout || 30000,
            validateStatus: function () { return true; },
        });

        var elapsed = Date.now() - startTime;
        var status = response.status;

        if (status >= 400) {
            console.log('[EVENTS] ✗ Session', sessionId, '→ HTTP', status, 'in', elapsed, 'ms');
            return [];
        }

        const data = response.data;
        if (data && data.content && Array.isArray(data.content)) {
            console.log('[EVENTS]   ✓ Session', sessionId, '→', data.content.length, 'events in', elapsed, 'ms');
            return data.content;
        }

        var result = Array.isArray(data) ? data : [];
        console.log('[EVENTS]   ✓ Session', sessionId, '→', result.length, 'events (raw) in', elapsed, 'ms');
        return result;

    } catch (err) {
        console.log('[EVENTS]   ✗ Session', sessionId, 'FAILED:', err.message, '(' + (Date.now() - startTime) + 'ms)');
        return [];
    }
}

async function ensureToken() {
    if (cachedToken) return cachedToken;
    console.log('[API] No cached token, authenticating...');
    return authenticate();
}

function clearToken() {
    cachedToken = null;
}

module.exports = {
    authenticate,
    getSessions,
    getSessionEvents,
    clearToken,
};
