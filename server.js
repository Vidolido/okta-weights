/**
 * OKTA Truck KPI — Express.js + PUG application
 *
 * Lightweight dashboard for displaying truck loading/unloading data.
 * Data sources (in order of priority):
 *   1. OKTA API (live data)
 *   2. Excel fallback (RawEvents sheet)
 *   3. SQL Server database
 */
const express = require('express');
const path = require('path');
const fs = require('fs');

// ── Load config ─────────────────────────────────────────────────────
const configPath = path.resolve(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const PORT = config.server?.port || 6969;
const HOST = config.server?.host || '0.0.0.0';

// ── App setup ───────────────────────────────────────────────────────
const app = express();

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    maxAge: 0,
    setHeaders: function(res, path) {
        if (path.endsWith('.js') || path.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Make config available to PUG templates ──────────────────────────
app.locals.siteTitle = config.ui?.siteTitle || 'OKTA Truck KPI';
app.locals.defaultRowsPerPage = config.ui?.defaultRowsPerPage || 50;
app.locals.defaultDateRangeDays = config.ui?.defaultDateRangeDays || 30;

// ── Data Loader (handles API → Excel → DB fallback) ────────────────
const dataLoader = require('./services/dataLoader');

// Initialize data on startup (non-blocking)
dataLoader.initialize().then(function () {
    const status = dataLoader.getStatus();
    console.log('[OKTA] Data source:', status.source);
    console.log('[OKTA] Records loaded:', status.recordCount, '(' + status.loadCount + ' load, ' + status.unloadCount + ' unload)');
    if (status.error) {
        console.log('[OKTA] Status:', status.error);
    }
}).catch(function (err) {
    console.error('[OKTA] Data initialization failed:', err.message);
});

// ── Page route ──────────────────────────────────────────────────────
app.get('/', function (req, res) {
    res.render('index', {
        title: app.locals.siteTitle,
        defaultRowsPerPage: app.locals.defaultRowsPerPage,
        defaultDateRangeDays: app.locals.defaultDateRangeDays,
    });
});

// ── API routes ──────────────────────────────────────────────────────

// API connectivity test — hit this in browser to diagnose API issues
app.get('/api/test-connection', async function (req, res) {
    var results = {
        timestamp: new Date().toISOString(),
        steps: [],
    };

    try {
        var apiClient = require('./services/apiClient');
        var cfg = require('./config.json').api;

        // Step 1: Show config
        results.steps.push({ step: 'config', baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, clientId: cfg.clientId });

        // Step 2: Test DNS resolution
        try {
            var dns = require('dns');
            var url = new URL(cfg.baseUrl);
            var hostname = url.hostname;
            var dnsResult = await new Promise(function(resolve, reject) {
                dns.lookup(hostname, function(err, address, family) {
                    if (err) reject(err);
                    else resolve({ hostname: hostname, address: address, family: family });
                });
            });
            results.steps.push({ step: 'dns', status: 'ok', data: dnsResult });
        } catch (dnsErr) {
            results.steps.push({ step: 'dns', status: 'failed', error: dnsErr.message, hostname: hostname });
        }

        // Step 3: Test raw TCP connection
        try {
            var net = require('net');
            var url = new URL(cfg.baseUrl);
            var host = url.hostname;
            var port = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
            var tcpResult = await new Promise(function(resolve, reject) {
                var socket = new net.Socket();
                socket.setTimeout(5000);
                socket.on('connect', function() {
                    socket.destroy();
                    resolve({ host: host, port: port, connected: true });
                });
                socket.on('timeout', function() {
                    socket.destroy();
                    reject(new Error('TCP connection timeout after 5s'));
                });
                socket.on('error', function(err) {
                    socket.destroy();
                    reject(err);
                });
                socket.connect(port, host);
            });
            results.steps.push({ step: 'tcp', status: 'ok', data: tcpResult });
        } catch (tcpErr) {
            results.steps.push({ step: 'tcp', status: 'failed', error: tcpErr.message, host: host, port: port });
        }

        // Step 4: Auth
        var authStart = Date.now();
        try {
            var token = await apiClient.authenticate();
            results.steps.push({
                step: 'auth',
                status: 'ok',
                timeMs: Date.now() - authStart,
                tokenLength: token ? token.length : 0,
                tokenFull: token || null
            });
        } catch (authErr) {
            results.steps.push({
                step: 'auth',
                status: 'failed',
                timeMs: Date.now() - authStart,
                error: authErr.message,
                code: authErr.code || null
            });
        }

        // Step 5: Fetch one session
        if (results.steps[results.steps.length - 1].status === 'ok') {
            var sessStart = Date.now();
            try {
                var modFrom = new Date();
                modFrom.setDate(modFrom.getDate() - 7);
                var modFromStr = modFrom.toISOString().split('T')[0] + 'T00:00:00';
                var sessions = await apiClient.getSessions(modFromStr);
                results.steps.push({
                    step: 'sessions',
                    status: 'ok',
                    timeMs: Date.now() - sessStart,
                    count: sessions.length,
                    firstSession: sessions.length > 0 ? JSON.stringify(sessions[0]).substring(0, 300) : null
                });
            } catch (sessErr) {
                results.steps.push({
                    step: 'sessions',
                    status: 'failed',
                    timeMs: Date.now() - sessStart,
                    error: sessErr.message,
                    code: sessErr.code || null
                });
            }
        }

    } catch (e) {
        results.error = e.message;
    }

    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(results, null, 2));
});

// KPI data — serves from in-memory store (loaded from API/Excel/DB)
app.get('/api/data/kpi', function (req, res) {
    try {
        const status = dataLoader.getStatus();

        if (!status.loaded) {
            return res.status(503).json({
                error: 'Data not yet loaded.',
                status: status,
            });
        }

        const result = dataLoader.getKpiData({
            type: req.query.type,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            page: parseInt(req.query.page) || 1,
            pageSize: parseInt(req.query.pageSize) || 50,
            sortColumn: req.query.sortColumn || 'sessionCreationTime',
            sortDirection: req.query.sortDirection || 'desc',
            columns: req.query.columns,
            search: req.query.search,
        });

        res.json(result);
    } catch (err) {
        console.error('[getKpiData]', err);
        res.status(500).json({ error: 'Failed to fetch KPI data.', details: err.message });
    }
});

// Data loader status (replaces sync-status for the in-memory approach)
app.get('/api/data/sync-status', function (req, res) {
    const status = dataLoader.getStatus();
    res.json({
        source: status.source,
        loaded: status.loaded,
        recordCount: status.recordCount,
        loadCount: status.loadCount,
        unloadCount: status.unloadCount,
        lastLoadTime: status.lastLoadTime,
        error: status.error,
    });
});

// Export endpoints (still require database for full export)
const exportCsv        = require('./handlers/exportCsv');
const exportExcel      = require('./handlers/exportExcel');
const exportUnload2Csv = require('./handlers/exportUnload2Csv');
const exportUnload2Excel = require('./handlers/exportUnload2Excel');
const getUnload2Data   = require('./handlers/getUnload2Data');

app.get('/api/data/unload2',       getUnload2Data);
app.get('/api/export/csv',         exportCsv);
app.get('/api/export/excel',       exportExcel);
app.get('/api/export/unload2-csv', exportUnload2Csv);
app.get('/api/export/unload2-excel', exportUnload2Excel);

// ── Start server ────────────────────────────────────────────────────
app.listen(PORT, HOST, function () {
    console.log('[OKTA] Server running at http://' + HOST + ':' + PORT);
    console.log('[OKTA] Site title: ' + app.locals.siteTitle);
}).on('error', function (err) {
    console.error('[OKTA] Failed to start server:', err.message);
    process.exit(1);
});
