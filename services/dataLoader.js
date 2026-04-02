/**
 * Data Loader
 * Orchestrates data loading on startup:
 *   1. Try the API → process events into KPI records → serve
 *   2. If API fails → try loading from Excel KPI sheet
 *   3. If Excel also fails → try loading from database
 *
 * All sources are normalized to frontend column names.
 */

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

let kpiStore = [];
let storeStatus = {
    loaded: false,
    source: 'none',
    error: null,
    recordCount: 0,
    loadCount: 0,
    unloadCount: 0,
    lastLoadTime: null,
};

async function initialize() {
    console.log('[DataLoader] Starting data initialization...');
    if (await tryLoadFromApi()) return;
    if (await tryLoadFromExcel()) return;
    if (await tryLoadFromDatabase()) return;
    storeStatus.error = 'All data sources failed.';
    console.error('[DataLoader] All data sources failed.');
}

// ── API Loader ─────────────────────────────────────────────────────

async function tryLoadFromApi() {
    console.log('[DataLoader] Attempting API connection...');
    storeStatus.source = 'api';
    try {
        var apiClient = require('./apiClient');
        var kpiProcessor = require('./kpiProcessor');
        await apiClient.authenticate();

        var modFrom = new Date();
        modFrom.setDate(modFrom.getDate() - 30);
        var sessions = await apiClient.getSessions(modFrom.toISOString().split('T')[0] + 'T00:00:00');
        console.log('[DataLoader] API returned', sessions.length, 'sessions');

        var records = [];
        for (var i = 0; i < sessions.length; i++) {
            try {
                var events = await apiClient.getSessionEvents(sessions[i].auraId);
                var kpi = kpiProcessor.processSession(sessions[i], events);
                if (kpi) records.push(kpi);
                await new Promise(function (r) { setTimeout(r, 300); });
            } catch (e) {
                console.warn('[DataLoader] Session', sessions[i].auraId, 'failed:', e.message);
            }
        }

        if (records.length > 0) {
            kpiStore = records;
            finishLoad(records);
            return true;
        }
        storeStatus.error = 'API returned 0 processable sessions.';
        return false;
    } catch (e) {
        console.error('[DataLoader] API failed:', e.message);
        storeStatus.error = 'API connection failed: ' + e.message;
        return false;
    }
}

// ── Excel Loader ────────────────────────────────────────────────────

async function tryLoadFromExcel() {
    console.log('[DataLoader] Attempting Excel fallback...');
    storeStatus.source = 'excel';

    var excelPath = path.resolve(__dirname, '..', '_material', 'Okta_EventDump_ProofOfConce222222pt.xlsm');
    if (!fs.existsSync(excelPath)) {
        storeStatus.error = 'Excel file not found.';
        return false;
    }

    try {
        // Fast path: pre-parsed JSON
        var jsonPath = path.resolve(__dirname, '..', '_material', 'kpi_data.json');
        if (fs.existsSync(jsonPath)) {
            console.log('[DataLoader] Loading pre-parsed JSON...');
            var raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            if (raw.length > 0) {
                kpiStore = raw;
                finishLoad(kpiStore);
                return true;
            }
        }

        // Slow path: parse Excel KPI sheet
        console.log('[DataLoader] Parsing Excel KPI sheet...');
        var wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(excelPath);
        var sheet = wb.getWorksheet('KPI');
        if (!sheet) { storeStatus.error = 'KPI sheet not found.'; return false; }

        var headers = [];
        var hr = sheet.getRow(1);
        for (var c = 1; c <= sheet.columnCount; c++) {
            var v = hr.getCell(c).value;
            if (v && typeof v === 'object' && v.richText) v = v.richText.map(function(x) { return x.text; }).join('');
            headers.push(v);
        }

        var rawRecs = [];
        for (var r = 2; r <= sheet.rowCount; r++) {
            var row = sheet.getRow(r);
            var rec = {};
            for (var c2 = 1; c2 <= headers.length; c2++) {
                var val = row.getCell(c2).value;
                if (val && typeof val === 'object' && val.richText) val = val.richText.map(function(x) { return x.text; }).join('');
                if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
                rec[headers[c2 - 1]] = val;
            }
            rawRecs.push(rec);
        }

        if (rawRecs.length > 0) {
            kpiStore = rawRecs.map(normalizeRow);
            finishLoad(kpiStore);
            return true;
        }
        storeStatus.error = 'Excel KPI sheet empty.';
        return false;
    } catch (e) {
        console.error('[DataLoader] Excel failed:', e.message);
        storeStatus.error = 'Excel load failed: ' + e.message;
        return false;
    }
}

// ── Database Loader ─────────────────────────────────────────────────

async function tryLoadFromDatabase() {
    console.log('[DataLoader] Attempting database fallback...');
    storeStatus.source = 'database';
    try {
        var db = require('../db/connection');
        var result = await db.query('SELECT * FROM KPIs ORDER BY SessionCreationTime DESC');
        if (result.recordset && result.recordset.length > 0) {
            kpiStore = result.recordset.map(function (row) {
                return {
                    driver: row.Driver,
                    licensePlate: row.LicensePlate,
                    status: row.Status,
                    workOrderType: row.WorkOrderType,
                    sessionCreationTime: row.SessionCreationTime instanceof Date ? row.SessionCreationTime.toISOString() : row.SessionCreationTime,
                    sessionClosingTime: row.SessionClosingTime instanceof Date ? row.SessionClosingTime.toISOString() : row.SessionClosingTime,
                    derivate: row.Derivate,
                    smsNotificationTime: row.SmsNotificationTime instanceof Date ? row.SmsNotificationTime.toISOString() : row.SmsNotificationTime,
                    firstWeighingTime: row.FirstWeighingTime instanceof Date ? row.FirstWeighingTime.toISOString() : row.FirstWeighingTime,
                    firstWeighingKg: row.FirstWeighingKg,
                    secondWeighingTime: row.SecondWeighingTime instanceof Date ? row.SecondWeighingTime.toISOString() : row.SecondWeighingTime,
                    secondWeighingKg: row.SecondWeighingKg,
                    netQuantityKg: row.NetQuantityKg,
                    barrierEntranceTime: row.BarrierEntranceTime instanceof Date ? row.BarrierEntranceTime.toISOString() : row.BarrierEntranceTime,
                    barrierExitTime: row.BarrierExitTime instanceof Date ? row.BarrierExitTime.toISOString() : row.BarrierExitTime,
                };
            });
            finishLoad(kpiStore);
            return true;
        }
        storeStatus.error = 'Database KPIs table empty.';
        return false;
    } catch (e) {
        console.error('[DataLoader] Database failed:', e.message);
        storeStatus.error = 'Database failed: ' + e.message;
        return false;
    }
}

// ── Row Normalizer ──────────────────────────────────────────────────
// Maps KPI sheet column names to frontend column names.

function normalizeRow(row) {
    var type = row['Work Order Type'] || '';
    var firstTime, firstKg, secondTime, secondKg, net;

    if (type === 'load') {
        firstTime = row['1st Weighing Time (L)'];
        firstKg = row['1st Weighing [kg] (L)'];
        secondTime = row['2nd Weighing Time (L)'];
        secondKg = row['2nd Weighing [kg] (L)'];
        net = row['Loaded Qty [kg]'];
    } else {
        firstTime = row['1st Weighing Time (U)'];
        firstKg = row['1st Weighing [kg] (U)'];
        secondTime = row['2nd Weighing Time (U)'];
        secondKg = row['2nd Weighing [kg] (U)'];
        net = row['Unloaded Qty [kg]'];
    }

    // Parse Materials & Quantities into separate derivate name + qty
    var parsed = parseMaterials(row['Materials & Quantities']);

    return {
        driver: row['Driver'],
        licensePlate: row['License Plate'],
        status: row['Status'],
        workOrderType: type,
        sessionCreationTime: toIso(row['Session Creation Time']),
        sessionClosingTime: toIso(row['Session Closing Time']),
        derivate: parsed.derivate,
        derivateQty: parsed.qty,
        smsNotificationTime: toIso(row['SMS Notification Time']),
        firstWeighingTime: toIso(firstTime),
        firstWeighingKg: firstKg,
        secondWeighingTime: toIso(secondTime),
        secondWeighingKg: secondKg,
        netQuantityKg: net,
        barrierEntranceTime: toIso(row['Barrier Entrance (U)']),
        barrierExitTime: toIso(row['Barrier Exit (U)']),
    };
}

/**
 * Parse "Materials & Quantities" string into {derivate, qty}.
 * Examples:
 *   "ULSD 33000"              -> {derivate: "ULSD", qty: 33000}
 *   "JET FUEL 19700"         -> {derivate: "JET FUEL", qty: 19700}
 *   "JET FUEL 34800 KONTROLNO" -> {derivate: "JET FUEL", qty: 34800}
 *   "ULSD 29575; UNL 95 12000" -> {derivate: "ULSD; UNL 95", qty: "29575; 12000"}
 *   null                      -> {derivate: null, qty: null}
 */
function parseMaterials(raw) {
    if (!raw) return { derivate: null, qty: null };

    var str = String(raw).trim();
    if (!str) return { derivate: null, qty: null };

    // Split by semicolon for multiple materials
    var parts = str.split(';').map(function(s) { return s.trim(); }).filter(Boolean);

    var names = [];
    var qtys = [];

    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];

        // Find the LAST large number (3+ digits) — that's the quantity
        // Everything before it is the material name
        // e.g. "UNL 95 33100"           -> name="UNL 95",   qty=33100
        // e.g. "JET FUEL 19700 KONTROLNO" -> name="JET FUEL", qty=19700
        // e.g. "ULSD 29575"              -> name="ULSD",     qty=29575
        var lastNumMatch = part.match(/^(.*?)\s+(\d{3,})(?:\s.*)?$/);
        if (!lastNumMatch) {
            // Maybe no space before number: try any number
            lastNumMatch = part.match(/^(.*?)\b(\d{3,})\b/);
        }
        if (lastNumMatch) {
            var name = lastNumMatch[1].trim();
            var num = lastNumMatch[2];
            // var extra = match[3]; // discarded (KONTROLNO, messages, etc.)
            names.push(name);
            qtys.push(num);
        } else {
            // No number found — just a name
            names.push(part);
            qtys.push(null);
        }
    }

    return {
        derivate: names.length > 0 ? names.join('; ') : null,
        qty: qtys.length > 0 ? qtys.join('; ') : null,
    };
}

function toIso(val) {
    if (!val) return null;
    if (val instanceof Date) return val.toISOString();
    try { var d = new Date(val); return isNaN(d.getTime()) ? val : d.toISOString(); } catch (e) { return val; }
}

// ── Status ─────────────────────────────────────────────────────────

function finishLoad(store) {
    storeStatus.loaded = true;
    storeStatus.error = null;
    storeStatus.recordCount = store.length;
    storeStatus.loadCount = store.filter(function (r) { return r.workOrderType === 'load'; }).length;
    storeStatus.unloadCount = store.filter(function (r) { return r.workOrderType === 'unload'; }).length;
    storeStatus.lastLoadTime = new Date().toISOString();
    console.log('[DataLoader] Loaded:', storeStatus.recordCount, 'records (' + storeStatus.loadCount + ' load, ' + storeStatus.unloadCount + ' unload)');
}

// ── Query Engine ────────────────────────────────────────────────────

function getKpiData(params) {
    var data = kpiStore.slice();

    if (params.type === 'load' || params.type === 'unload') {
        data = data.filter(function (r) { return r.workOrderType === params.type; });
    }
    if (params.startDate) {
        var s = new Date(params.startDate);
        data = data.filter(function (r) { return r.sessionCreationTime && new Date(r.sessionCreationTime) >= s; });
    }
    if (params.endDate) {
        var e = new Date(params.endDate);
        data = data.filter(function (r) { return r.sessionCreationTime && new Date(r.sessionCreationTime) < e; });
    }
    if (params.search) {
        var term = params.search.toLowerCase();
        data = data.filter(function (r) {
            return String(r.driver || '').toLowerCase().includes(term)
                || String(r.licensePlate || '').toLowerCase().includes(term)
                || (r.netQuantityKg !== null && r.netQuantityKg !== undefined && String(Math.round(r.netQuantityKg)).includes(term));
        });
    }

    var total = data.length;
    var sortCol = params.sortColumn || 'sessionCreationTime';
    var dir = params.sortDirection === 'asc' ? 1 : -1;
    data.sort(function (a, b) {
        var va = a[sortCol] || '', vb = b[sortCol] || '';
        return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
    });

    var page = Math.max(1, params.page || 1);
    var ps = Math.min(500, Math.max(1, params.pageSize || 50));
    var paged = data.slice((page - 1) * ps, page * ps);

    var cols = params.columns ? params.columns.split(',').map(function (c) { return c.trim(); }) : null;
    var projected = paged.map(function (row) {
        if (!cols || cols.length === 0) return row;
        var o = {};
        cols.forEach(function (c) { o[c] = row[c]; });
        return o;
    });

    return { data: projected, totalRecords: total, page: page, pageSize: ps, totalPages: Math.ceil(total / ps) || 1 };
}

function getStatus() { return Object.assign({}, storeStatus); }

module.exports = { initialize: initialize, getKpiData: getKpiData, getStatus: getStatus, normalizeRow: normalizeRow };
