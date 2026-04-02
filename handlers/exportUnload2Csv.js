/**
 * GET /api/export/unload2-csv
 * Export Unload2 data as CSV download.
 */
const { query, sql, validateSqlIdentifier, loadAppConfig } = require('../db/connection');
const { Parser } = require('json2csv');

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
    return String(Math.round(Number(val)));
}

module.exports = async function exportUnload2Csv(req, res) {
    try {
        const config = loadAppConfig();
        const ui = config.ui || {};
        const ext = config.externalDatabase || {};
        const defaultDateRangeDays = ui.defaultDateRangeDays || 30;

        const now = new Date();
        const startDefault = new Date(now);
        startDefault.setDate(startDefault.getDate() - defaultDateRangeDays);
        const endDefault = new Date(now);
        endDefault.setDate(endDefault.getDate() + 1);

        const startDate = req.query.startDate ? new Date(req.query.startDate) : startDefault;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : endDefault;

        const linkedServer = validateSqlIdentifier(ext.linkedServerName, 'linkedServerName');
        const extDb = validateSqlIdentifier(ext.databaseName, 'databaseName');
        const extTable = validateSqlIdentifier(ext.tableName, 'tableName');

        const dataSql = `
            SELECT File6_Data1 AS LicensePlate,
                   Weight1 AS FirstWeighingKg,
                   Date1 AS FirstWeighingTime,
                   Weight2 AS SecondWeighingKg,
                   Date2 AS SecondWeighingTime,
                   Net AS NetQuantityKg
            FROM [${linkedServer}].[${extDb}].[${extTable}]
            WHERE Date1 >= @startDate AND Date1 < @endDate
            ORDER BY Date1 DESC
        `;

        const result = await query(dataSql, { startDate, endDate });

        const fields = [
            'License Plate', '1st Weighing [kg]', '1st Weighing Time',
            '2nd Weighing [kg]', '2nd Weighing Time', 'Unloaded Qty [kg]',
        ];

        const rows = result.recordset.map(row => ({
            'License Plate': row.LicensePlate || '',
            '1st Weighing [kg]': formatWeight(row.FirstWeighingKg),
            '1st Weighing Time': formatDate(row.FirstWeighingTime),
            '2nd Weighing [kg]': formatWeight(row.SecondWeighingKg),
            '2nd Weighing Time': formatDate(row.SecondWeighingTime),
            'Unloaded Qty [kg]': formatWeight(row.NetQuantityKg),
        }));

        const parser = new Parser({ fields });
        const csv = parser.parse(rows);

        const fileName = `unload2_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send('\ufeff' + csv);
    } catch (err) {
        console.error('[exportUnload2Csv]', err);
        res.status(500).json({ error: 'Failed to export CSV.', details: err.message });
    }
};
