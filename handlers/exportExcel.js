/**
 * GET /api/export/excel
 * Export KPI data as Excel (.xlsx) download.
 */
const { query, sql, validateSqlIdentifier, loadAppConfig } = require('../db/connection');
const ExcelJS = require('exceljs');

const LOAD_COLUMNS = [
    'LicensePlate', 'SessionCreationTime', 'SessionClosingTime', 'Derivate',
    'SmsNotificationTime', 'FirstWeighingTime', 'FirstWeighingKg',
    'SecondWeighingTime', 'SecondWeighingKg', 'NetQuantityKg',
];

const UNLOAD_COLUMNS = [
    'LicensePlate', 'SessionCreationTime', 'SessionClosingTime', 'Derivate',
    'SmsNotificationTime', 'FirstWeighingTime', 'FirstWeighingKg',
    'BarrierEntranceTime', 'BarrierExitTime',
    'SecondWeighingTime', 'SecondWeighingKg', 'NetQuantityKg',
];

const DISPLAY_NAMES = {
    LicensePlate: 'License Plate',
    SessionCreationTime: 'Session Creation Time',
    SessionClosingTime: 'Session Closing Time',
    Derivate: 'Derivate',
    SmsNotificationTime: 'SMS Notification Time',
    FirstWeighingTime: '1st Weighing Time',
    FirstWeighingKg: '1st Weighing [kg]',
    SecondWeighingTime: '2nd Weighing Time',
    SecondWeighingKg: '2nd Weighing [kg]',
    NetQuantityKg: 'Net Qty [kg]',
    BarrierEntranceTime: 'Barrier Entrance',
    BarrierExitTime: 'Barrier Exit',
    Driver: 'Driver',
};

function formatDate(val) {
    if (!val) return '';
    if (val instanceof Date) {
        const dd = String(val.getDate()).padStart(2, '0');
        const mm = String(val.getMonth() + 1).padStart(2, '0');
        const yy = val.getFullYear();
        const hh = String(val.getHours()).padStart(2, '0');
        const mi = String(val.getMinutes()).padStart(2, '0');
        return `${dd}-${mm}-${yy} ${hh}:${mi}`;
    }
    return String(val);
}

function formatWeight(val) {
    if (val === null || val === undefined) return '';
    return Math.round(Number(val));
}

module.exports = async function exportExcel(req, res) {
    try {
        const config = loadAppConfig();
        const ui = config.ui || {};
        const defaultDateRangeDays = ui.defaultDateRangeDays || 30;
        const dataRetentionDays = ui.dataRetentionDays || 365;

        const type = req.query.type;
        if (type !== 'load' && type !== 'unload') {
            return res.status(400).json({ error: "type must be 'load' or 'unload'" });
        }

        const columnsParam = req.query.columns || '';
        let requestedCols = columnsParam
            ? columnsParam.split(',').map(c => c.trim()).filter(Boolean)
            : null;

        if (!requestedCols || requestedCols.length === 0) {
            requestedCols = type === 'load' ? [...LOAD_COLUMNS] : [...UNLOAD_COLUMNS];
        }

        // Date range
        const now = new Date();
        const startDefault = new Date(now);
        startDefault.setDate(startDefault.getDate() - defaultDateRangeDays);
        const endDefault = new Date(now);
        endDefault.setDate(endDefault.getDate() + 1);

        const startDate = req.query.startDate ? new Date(req.query.startDate) : startDefault;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : endDefault;
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - dataRetentionDays);

        const dataSql = `
            SELECT * FROM KPIs
            WHERE WorkOrderType = @type
              AND SessionCreationTime >= @startDate
              AND SessionCreationTime < @endDate
              AND SessionCreationTime >= @cutoff
            ORDER BY SessionCreationTime DESC
        `;

        const result = await query(dataSql, { type, startDate, endDate, cutoff });

        // Build workbook
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
            stream: res,
            useStyles: false,
            useSharedStrings: false,
        });

        const fileName = `kpi_${type}_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        const sheet = workbook.addWorksheet('KPI Data');

        // Header row
        const headers = requestedCols.map(c => DISPLAY_NAMES[c] || c);
        sheet.columns = headers.map(h => ({ header: h, key: h, width: 20 }));

        // Bold header
        sheet.getRow(1).font = { bold: true };

        // Data rows
        for (const row of result.recordset) {
            const values = {};
            for (const col of requestedCols) {
                const displayName = DISPLAY_NAMES[col] || col;
                let val = row[col];
                if (col.includes('Time') || col.includes('time')) {
                    val = formatDate(val);
                } else if (col.includes('Kg') || col === 'NetQuantityKg') {
                    val = formatWeight(val);
                }
                values[displayName] = val ?? '';
            }
            sheet.addRow(values).commit();
        }

        await workbook.commit();
    } catch (err) {
        console.error('[exportExcel]', err);
        res.status(500).json({ error: 'Failed to export Excel.', details: err.message });
    }
};
