/**
 * OKTA API Client
 * Authenticates against the OKTA API, fetches sessions, fetches session events.
 * Ported from ApiClient.cs in the original OktaData project.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load API config from config.json
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
 * POST /open-api/auth with X-Api-Key header + body {clientId, clientSecret}
 * Returns bearer token string.
 */
async function authenticate() {
    const cfg = getApiConfig();
    const url = cfg.baseUrl + 'open-api/auth';

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║              API AUTHENTICATION                  ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('[API] Base URL from config:', cfg.baseUrl);
    console.log('[API] Full auth URL:', url);
    console.log('[API] X-Api-Key:', cfg.apiKey);
    console.log('[API] ClientId:', cfg.clientId);
    console.log('[API] ClientSecretHash:', cfg.clientSecretHash ? cfg.clientSecretHash.substring(0, 12) + '...' + cfg.clientSecretHash.slice(-8) : 'NOT SET');
    console.log('[API] Request timeout:', cfg.requestTimeout || 30000, 'ms');
    console.log('[API] modFrom:', cfg.modFrom);
    console.log('');

    console.log('[API] Step 1: Sending POST to', url);

    var requestData = {
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecretHash,
    };
    console.log('[API] Step 1: Request body:', JSON.stringify(requestData, null, 2));
    console.log('[API] Step 1: Request headers:', JSON.stringify({
        'Accept': 'application/json',
        'X-Api-Key': String(cfg.apiKey),
    }, null, 2));

    try {
        const response = await axios.request({
            method: 'POST',
            url: url,
            headers: {
                'Accept': 'application/json',
                'X-Api-Key': String(cfg.apiKey),
            },
            data: requestData,
            timeout: cfg.requestTimeout || 30000,
        });

        console.log('[API] Step 2: Auth response received');
        console.log('[API] Step 2: HTTP status:', response.status, response.statusText);
        console.log('[API] Step 2: Response headers:', JSON.stringify(response.headers, null, 2));
        console.log('[API] Step 2: Response data type:', typeof response.data);
        console.log('[API] Step 2: Response data (raw):', JSON.stringify(response.data).substring(0, 500));

        // The token might come back in various formats
        let token = response.data;

        if (typeof token === 'string' && token.startsWith('"') && token.endsWith('"')) {
            console.log('[API] Step 3: Token is a quoted string, unwrapping...');
            token = JSON.parse(token);
        }

        if (typeof token === 'object' && token !== null) {
            console.log('[API] Step 3: Token is an object, keys:', Object.keys(token));
            if (token.token) {
                console.log('[API] Step 3: Found token.token property');
                token = token.token;
            } else if (token.access_token) {
                console.log('[API] Step 3: Found token.access_token property');
                token = token.access_token;
            } else {
                console.log('[API] Step 3: No known token property found, using stringified object');
                token = JSON.stringify(token);
            }
        }

        cachedToken = token;
        console.log('');
        console.log('[API] ✓ Authentication SUCCESSFUL');
        console.log('[API] Token type:', typeof cachedToken);
        console.log('[API] Token length:', String(cachedToken).length);
        console.log('[API] Token preview:', String(cachedToken).substring(0, 50) + (String(cachedToken).length > 50 ? '...' : ''));
        console.log('');

        return token;

    } catch (err) {
        console.log('');
        console.log('[API] ✗ Authentication FAILED');
        console.log('[API] Error name:', err.name);
        console.log('[API] Error message:', err.message);
        if (err.code) console.log('[API] Error code:', err.code);
        if (err.config) {
            console.log('[API] Failed request URL:', err.config.url);
            console.log('[API] Failed request method:', err.config.method);
            console.log('[API] Failed request headers:', JSON.stringify(err.config.headers, null, 2));
        }
        if (err.response) {
            console.log('[API] Response status:', err.response.status);
            console.log('[API] Response data:', JSON.stringify(err.response.data).substring(0, 500));
        }
        console.log('');
        throw err;
    }
}

/**
 * Fetch sessions modified since a given date.
 * GET /open-api/sessions?modFrom={modFrom}
 * Returns array of session objects.
 */
async function getSessions(modFrom) {
    const cfg = getApiConfig();
    const token = await ensureToken();
    const url = cfg.baseUrl + 'open-api/sessions?modFrom=' + encodeURIComponent(modFrom);

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║              FETCH SESSIONS                      ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('[API] Full URL:', url);
    console.log('[API] modFrom:', modFrom);
    console.log('[API] Using token (preview):', String(token).substring(0, 50) + '...');
    console.log('[API] X-Api-Key:', cfg.apiKey);

    try {
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/json',
                'X-Api-Key': String(cfg.apiKey),
                'Authorization': 'Bearer ' + token,
            },
            timeout: cfg.requestTimeout || 30000,
        });

        console.log('[API] Sessions response status:', response.status);
        console.log('[API] Sessions response data type:', typeof response.data);

        const sessions = response.data;
        const count = Array.isArray(sessions) ? sessions.length : 'NOT AN ARRAY (' + typeof sessions + ')';
        console.log('[API] Sessions count:', count);

        if (count > 0 && count !== 'NOT AN ARRAY') {
            console.log('[API] First session keys:', Object.keys(sessions[0]));
            console.log('[API] First session preview:', JSON.stringify(sessions[0]).substring(0, 300));
        }

        console.log('[API] ✓ Sessions fetched successfully');
        console.log('');

        return Array.isArray(sessions) ? sessions : [];

    } catch (err) {
        console.log('');
        console.log('[API] ✗ Fetch sessions FAILED');
        console.log('[API] Error:', err.message);
        if (err.code) console.log('[API] Error code:', err.code);
        if (err.config) console.log('[API] Failed request URL:', err.config.url);
        if (err.response) {
            console.log('[API] Response status:', err.response.status);
            console.log('[API] Response data:', JSON.stringify(err.response.data).substring(0, 500));
        }
        console.log('');
        throw err;
    }
}

/**
 * Fetch events for a specific session.
 * GET /open-api/session/events?parent_id={sessionId}
 * Response shape: {content: [...]}
 * Returns array of event objects.
 */
async function getSessionEvents(sessionId) {
    const cfg = getApiConfig();
    const token = await ensureToken();
    const url = cfg.baseUrl + 'open-api/session/events?parent_id=' + encodeURIComponent(String(sessionId));

    console.log('[API] Fetching events for session:', sessionId, '→', url);

    try {
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/json',
                'X-Api-Key': String(cfg.apiKey),
                'Authorization': 'Bearer ' + token,
            },
            timeout: cfg.requestTimeout || 30000,
        });

        const data = response.data;

        // Response may be wrapped in {content: [...]}
        if (data && data.content && Array.isArray(data.content)) {
            console.log('[API]   → Events (from .content):', data.content.length);
            return data.content;
        }

        var result = Array.isArray(data) ? data : [];
        console.log('[API]   → Events (raw array):', result.length);
        return result;

    } catch (err) {
        console.log('[API]   ✗ Events fetch FAILED for session', sessionId, ':', err.message);
        if (err.code) console.log('[API]   Error code:', err.code);
        if (err.config) console.log('[API]   Failed request URL:', err.config.url);
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
