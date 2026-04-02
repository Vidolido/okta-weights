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
