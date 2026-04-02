/**
 * Okta Truck KPI — Express.js + PUG application
 *
 * Lightweight dashboard for displaying truck loading/unloading data
 * from a SQL Server database.
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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Make config available to PUG templates ──────────────────────────
app.locals.siteTitle = config.ui?.siteTitle || 'OKTA Truck KPI';
app.locals.defaultRowsPerPage = config.ui?.defaultRowsPerPage || 50;
app.locals.defaultDateRangeDays = config.ui?.defaultDateRangeDays || 30;

// ── Page route ──────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.render('index', {
        title: app.locals.siteTitle,
        defaultRowsPerPage: app.locals.defaultRowsPerPage,
        defaultDateRangeDays: app.locals.defaultDateRangeDays,
    });
});

// ── API routes (one handler per file) ───────────────────────────────
const getKpiData       = require('./handlers/getKpiData');
const getUnload2Data   = require('./handlers/getUnload2Data');
const getSyncStatus    = require('./handlers/getSyncStatus');
const exportCsv        = require('./handlers/exportCsv');
const exportExcel      = require('./handlers/exportExcel');
const exportUnload2Csv = require('./handlers/exportUnload2Csv');
const exportUnload2Excel = require('./handlers/exportUnload2Excel');

app.get('/api/data/kpi',          getKpiData);
app.get('/api/data/unload2',      getUnload2Data);
app.get('/api/data/sync-status',  getSyncStatus);
app.get('/api/export/csv',        exportCsv);
app.get('/api/export/excel',      exportExcel);
app.get('/api/export/unload2-csv',    exportUnload2Csv);
app.get('/api/export/unload2-excel',  exportUnload2Excel);

// ── Start server ────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
    console.log(`[OKTA] Server running at http://${HOST}:${PORT}`);
    console.log(`[OKTA] Site title: ${app.locals.siteTitle}`);
}).on('error', (err) => {
    console.error('[OKTA] Failed to start server:', err.message);
    process.exit(1);
});
