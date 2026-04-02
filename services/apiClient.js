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

    console.log('[API] Authenticating against:', url);

    const response = await axios.request({
        method: 'POST',
        url: url,
        headers: {
            'Accept': 'application/json',
            'X-Api-Key': String(cfg.apiKey),
        },
        data: {
            clientId: cfg.clientId,
            clientSecret: cfg.clientSecretHash,
        },
        timeout: 30000,
    });

    // The token might come back in various formats
    let token = response.data;

    if (typeof token === 'string' && token.startsWith('"') && token.endsWith('"')) {
        token = JSON.parse(token);
    }

    if (typeof token === 'object' && token !== null) {
        if (token.token) token = token.token;
        else if (token.access_token) token = token.access_token;
    }

    cachedToken = token;
    console.log('[API] Authentication successful, token length:', String(token).length);

    return token;
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

    console.log('[API] Fetching sessions, modFrom:', modFrom);

    const response = await axios.get(url, {
        headers: {
            'Accept': 'application/json',
            'X-Api-Key': String(cfg.apiKey),
            'Authorization': 'Bearer ' + token,
        },
        timeout: 30000,
    });

    const sessions = response.data;
    const count = Array.isArray(sessions) ? sessions.length : 0;
    console.log('[API] Fetched', count, 'sessions');

    return Array.isArray(sessions) ? sessions : [];
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

    const response = await axios.get(url, {
        headers: {
            'Accept': 'application/json',
            'X-Api-Key': String(cfg.apiKey),
            'Authorization': 'Bearer ' + token,
        },
        timeout: 30000,
    });

    const data = response.data;

    // Response may be wrapped in {content: [...]}
    if (data && data.content && Array.isArray(data.content)) {
        return data.content;
    }

    return Array.isArray(data) ? data : [];
}

async function ensureToken() {
    if (cachedToken) return cachedToken;
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
