/**
 * Data Loader
 * Orchestrates data loading on startup:
 *   1. Try the API → process events into KPI records → serve
 *   2. If API fails → try loading from Excel RawEvents sheet → process into KPI records
 *   3. If Excel also fails → serve from the database
 *
 * KPI records are kept in memory and served via /api/data/kpi
 */

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const apiClient = require('./apiClient');
const kpiProcessor = require('./kpiProcessor');

// In-memory KPI store
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

/**
 * Initialize data loading on server startup.
 * Tries API first, then falls back to Excel.
 */
async function initialize() {
    console.log('[DataLoader] Starting data initialization...');

    // Try API first
    const apiSuccess = await tryLoadFromApi();
    if (apiSuccess) {
        return;
    }

    // Try Excel fallback
    const excelSuccess = await tryLoadFromExcel();
    if (excelSuccess) {
        return;
    }

    // Try database
    const dbSuccess = await tryLoadFromDatabase();
    if (dbSuccess) {
        return;
    }

    storeStatus.error = 'All data sources failed. Check server logs for details.';
    console.error('[DataLoader] All data sources failed.');
}

/**
 * Try loading data from the OKTA API.
 */
async function tryLoadFromApi() {
    console.log('[DataLoader] Attempting API connection...');
    storeStatus.source = 'api';

    try {
        // Authenticate
        await apiClient.authenticate();

        // Fetch sessions (last 30 days)
        const modFrom = new Date();
        modFrom.setDate(modFrom.getDate() - 30);
        const modFromStr = modFrom.toISOString().split('T')[0] + 'T00:00:00';

        const sessions = await apiClient.getSessions(modFromStr);
        console.log('[DataLoader] API returned', sessions.length, 'sessions');

        // Process each session
        const records = [];

        for (const session of sessions) {
            try {
                // Fetch events for this session
                const events = await apiClient.getSessionEvents(session.auraId);

                // Process into KPI
                const kpi = kpiProcessor.processSession(session, events);
                if (kpi) {
                    records.push(kpi);
                }

                // Small delay to not hammer the API
                await new Promise(function (resolve) { setTimeout(resolve, 300); });

            } catch (err) {
                console.warn('[DataLoader] Failed to process session', session.auraId, ':', err.message);
            }
        }

        if (records.length > 0) {
            kpiStore = records;
            storeStatus.loaded = true;
            storeStatus.error = null;
            storeStatus.recordCount = records.length;
            storeStatus.loadCount = records.filter(function (r) { return r.workOrderType === 'load'; }).length;
            storeStatus.unloadCount = records.filter(function (r) { return r.workOrderType === 'unload'; }).length;
            storeStatus.lastLoadTime = new Date().toISOString();
            console.log('[DataLoader] API load successful:', storeStatus.recordCount, 'records (' + storeStatus.loadCount + ' load, ' + storeStatus.unloadCount + ' unload)');
            return true;
        }

        storeStatus.error = 'API returned 0 processable sessions.';
        return false;

    } catch (err) {
        const msg = 'API connection failed: ' + err.message;
        console.error('[DataLoader]', msg);
        storeStatus.error = msg;
        return false;
    }
}

/**
 * Try loading data from the Excel file in _material/
 * Reads the RawEvents sheet and processes each session's events into KPI records.
 */
async function tryLoadFromExcel() {
    console.log('[DataLoader] Attempting Excel fallback...');
    storeStatus.source = 'excel';

    const excelPath = path.resolve(__dirname, '..', '_material', 'Okta_EventDump_ProofOfConce222222pt.xlsm');

    if (!fs.existsSync(excelPath)) {
        const msg = 'Excel file not found: ' + excelPath;
        console.error('[DataLoader]', msg);
        storeStatus.error = msg;
        return false;
    }

    try {
        // Fast load: use pre-parsed JSON file
        const jsonPath = path.resolve(__dirname, '..', '_material', 'kpi_data.json');

        if (fs.existsSync(jsonPath)) {
            console.log('[DataLoader] Loading pre-parsed JSON...');
            const raw = fs.readFileSync(jsonPath, 'utf8');
            const records = JSON.parse(raw);

            if (records.length > 0) {
                kpiStore = records;
                storeStatus.loaded = true;
                storeStatus.error = null;
                storeStatus.recordCount = records.length;
                storeStatus.loadCount = records.filter(function (r) { return r.workOrderType === 'load'; }).length;
                storeStatus.unloadCount = records.filter(function (r) { return r.workOrderType === 'unload'; }).length;
                storeStatus.lastLoadTime = new Date().toISOString();
                console.log('[DataLoader] JSON load successful:', storeStatus.recordCount, 'records (' + storeStatus.loadCount + ' load, ' + storeStatus.unloadCount + ' unload)');
                return true;
            }
        }

        // Fallback: parse Excel directly (slow, ~30s for 20K rows)
        console.log('[DataLoader] JSON not found, parsing Excel directly (this may take a while)...');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(excelPath);

        const rawSheet = workbook.getWorksheet('RawEvents');
        if (!rawSheet) {
            storeStatus.error = 'RawEvents sheet not found in Excel file.';
            return false;
        }

        console.log('[DataLoader] Excel RawEvents sheet:', rawSheet.rowCount, 'rows');

        // Parse headers
        const headers = [];
        const headerRow = rawSheet.getRow(1);
        for (let c = 1; c <= rawSheet.columnCount; c++) {
            let v = headerRow.getCell(c).value;
            if (v && typeof v === 'object' && v.richText) v = v.richText.map(function (r) { return r.text; }).join('');
            headers.push(v);
        }

        // Group events by session
        const sessionMap = {};

        for (let r = 2; r <= rawSheet.rowCount; r++) {
            const row = rawSheet.getRow(r);
            const record = {};
            for (let c = 1; c <= rawSheet.columnCount; c++) {
                let v = row.getCell(c).value;
                if (v && typeof v === 'object' && v.richText) v = v.richText.map(function (rt) { return rt.text; }).join('');
                if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
                record[headers[c - 1]] = v;
            }

            const auraId = record.session_auraId;
            if (!auraId) continue;

            if (!sessionMap[auraId]) {
                sessionMap[auraId] = {
                    session: {
                        auraId: auraId,
                        createdOn: record.session_createdOn,
                        modifiedOn: record.session_modifiedOn,
                        state: record.session_state,
                        driver: record.session_driver,
                        vehicleFrontPlate: record.session_vehicleFrontPlate,
                        vehicleBackPlate: record.session_vehicleBackPlate,
                    },
                    events: [],
                };
            }

            sessionMap[auraId].events.push({
                occurenceSource: record.event_occurence_source,
                dtOccurence: record.event_dt_occurence,
                source: record.event_source,
                type: record.event_type,
                topic: record.event_topic,
                value: record.event_value,
                message: record.event_message,
            });
        }

        // Process each session into KPI
        const records = [];
        for (const auraId of Object.keys(sessionMap)) {
            const kpi = kpiProcessor.processSession(sessionMap[auraId].session, sessionMap[auraId].events);
            if (kpi) records.push(kpi);
        }

        if (records.length > 0) {
            kpiStore = records;
            storeStatus.loaded = true;
            storeStatus.error = null;
            storeStatus.recordCount = records.length;
            storeStatus.loadCount = records.filter(function (r) { return r.workOrderType === 'load'; }).length;
            storeStatus.unloadCount = records.filter(function (r) { return r.workOrderType === 'unload'; }).length;
            storeStatus.lastLoadTime = new Date().toISOString();
            console.log('[DataLoader] Excel load successful:', storeStatus.recordCount, 'records');
            return true;
        }

        storeStatus.error = 'Excel contained 0 processable sessions.';
        return false;

    } catch (err) {
        const msg = 'Excel load failed: ' + err.message;
        console.error('[DataLoader]', msg);
        storeStatus.error = msg;
        return false;
    }
}

/**
 * Try loading from the database (SQL Server).
 */
async function tryLoadFromDatabase() {
    console.log('[DataLoader] Attempting database fallback...');
    storeStatus.source = 'database';

    try {
        const { query } = require('../db/connection');
        const result = await query('SELECT * FROM KPIs ORDER BY SessionCreationTime DESC');

        if (result.recordset && result.recordset.length > 0) {
            kpiStore = result.recordset.map(function (row) {
                return {
                    sessionAuraId: row.SessionAuraId,
                    driver: row.Driver,
                    licensePlate: row.LicensePlate,
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

            storeStatus.loaded = true;
            storeStatus.error = null;
            storeStatus.recordCount = kpiStore.length;
            storeStatus.loadCount = kpiStore.filter(function (r) { return r.workOrderType === 'load'; }).length;
            storeStatus.unloadCount = kpiStore.filter(function (r) { return r.workOrderType === 'unload'; }).length;
            storeStatus.lastLoadTime = new Date().toISOString();
            console.log('[DataLoader] Database load successful:', storeStatus.recordCount, 'records');
            return true;
        }

        storeStatus.error = 'Database KPIs table is empty.';
        return false;

    } catch (err) {
        const msg = 'Database connection failed: ' + err.message;
        console.error('[DataLoader]', msg);
        storeStatus.error = msg;
        return false;
    }
}

/**
 * Get KPI data with filtering, sorting, pagination, search.
 * Works on the in-memory store — no DB needed.
 */
function getKpiData(params) {
    let data = [...kpiStore];

    // Filter by type
    if (params.type === 'load' || params.type === 'unload') {
        data = data.filter(function (r) { return r.workOrderType === params.type; });
    }

    // Filter by date range
    if (params.startDate) {
        const start = new Date(params.startDate);
        data = data.filter(function (r) {
            return r.sessionCreationTime && new Date(r.sessionCreationTime) >= start;
        });
    }
    if (params.endDate) {
        const end = new Date(params.endDate);
        data = data.filter(function (r) {
            return r.sessionCreationTime && new Date(r.sessionCreationTime) < end;
        });
    }

    // Search
    if (params.search) {
        const term = params.search.toLowerCase();
        data = data.filter(function (r) {
            return (r.driver && r.driver.toLowerCase().includes(term)) ||
                   (r.licensePlate && r.licensePlate.toLowerCase().includes(term)) ||
                   (r.netQuantityKg !== null && String(Math.round(r.netQuantityKg)).includes(term));
        });
    }

    const totalRecords = data.length;

    // Sort
    const sortCol = params.sortColumn || 'sessionCreationTime';
    const sortDir = params.sortDirection === 'asc' ? 1 : -1;

    data.sort(function (a, b) {
        const va = a[sortCol] || '';
        const vb = b[sortCol] || '';
        if (va < vb) return -1 * sortDir;
        if (va > vb) return 1 * sortDir;
        return 0;
    });

    // Paginate
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(500, Math.max(1, params.pageSize || 50));
    const offset = (page - 1) * pageSize;
    const paged = data.slice(offset, offset + pageSize);

    // Project to requested columns
    const columns = params.columns ? params.columns.split(',').map(function (c) { return c.trim(); }) : null;

    const projected = paged.map(function (row) {
        if (!columns || columns.length === 0) return row;
        const obj = {};
        columns.forEach(function (col) {
            if (row.hasOwnProperty(col)) {
                obj[col] = row[col];
            }
        });
        return obj;
    });

    return {
        data: projected,
        totalRecords: totalRecords,
        page: page,
        pageSize: pageSize,
        totalPages: Math.ceil(totalRecords / pageSize) || 1,
    };
}

/**
 * Get current status
 */
function getStatus() {
    return { ...storeStatus };
}

module.exports = {
    initialize,
    getKpiData,
    getStatus,
};
