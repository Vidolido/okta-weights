/**
 * GET /api/data/unload2
 * Fetch unload2 data from the external linked server database.
 */
const { query, sql, validateSqlIdentifier, loadAppConfig } = require('../db/connection');

const ALLOWED_SORT = new Set([
    'LicensePlate', 'FirstWeighingKg', 'FirstWeighingTime',
    'SecondWeighingKg', 'SecondWeighingTime', 'NetQuantityKg',
]);

module.exports = async function getUnload2Data(req, res) {
    try {
        const config = loadAppConfig();
        const ui = config.ui || {};
        const ext = config.externalDatabase || {};
        const defaultDateRangeDays = ui.defaultDateRangeDays || 30;

        // Params
        let page = Math.max(1, parseInt(req.query.page) || 1);
        let pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize) || 50));
        const sortCol = ALLOWED_SORT.has(req.query.sortColumn) ? req.query.sortColumn : 'FirstWeighingTime';
        const sortDir = req.query.sortDirection === 'asc' ? 'ASC' : 'DESC';
        const searchTerm = (req.query.search || '').trim();

        // Date range
        const now = new Date();
        const startDefault = new Date(now);
        startDefault.setDate(startDefault.getDate() - defaultDateRangeDays);
        const endDefault = new Date(now);
        endDefault.setDate(endDefault.getDate() + 1);

        const startDate = req.query.startDate ? new Date(req.query.startDate) : startDefault;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : endDefault;

        // Validate identifiers for linked server query
        const linkedServer = validateSqlIdentifier(ext.linkedServerName, 'linkedServerName');
        const extDb = validateSqlIdentifier(ext.databaseName, 'databaseName');
        const extTable = validateSqlIdentifier(ext.tableName, 'tableName');

        // Search condition
        let searchCondition = '';
        const params = {
            startDate,
            endDate,
        };

        if (searchTerm) {
            searchCondition = ` AND (File6_Data1 LIKE @search)`;
            params.search = `%${searchTerm}%`;
        }

        // Count
        const countSql = `
            SELECT COUNT(*) AS total
            FROM [${linkedServer}].[${extDb}].[${extTable}]
            WHERE Date1 >= @startDate AND Date1 < @endDate${searchCondition}
        `;
        const countResult = await query(countSql, params);
        const totalRecords = countResult.recordset[0].total;

        // Data
        const dataSql = `
            SELECT File6_Data1 AS LicensePlate,
                   Weight1 AS FirstWeighingKg,
                   Date1 AS FirstWeighingTime,
                   Weight2 AS SecondWeighingKg,
                   Date2 AS SecondWeighingTime,
                   Net AS NetQuantityKg
            FROM [${linkedServer}].[${extDb}].[${extTable}]
            WHERE Date1 >= @startDate AND Date1 < @endDate${searchCondition}
            ORDER BY ${sortCol} ${sortDir}
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
        `;
        params.offset = (page - 1) * pageSize;
        params.pageSize = pageSize;

        const dataResult = await query(dataSql, params);

        // Format dates
        const data = dataResult.recordset.map(row => {
            const obj = {};
            for (const [key, val] of Object.entries(row)) {
                obj[key] = val instanceof Date ? val.toISOString() : val;
            }
            return obj;
        });

        const totalPages = Math.ceil(totalRecords / pageSize);

        res.json({
            data,
            totalRecords,
            page,
            pageSize,
            totalPages,
        });
    } catch (err) {
        console.error('[getUnload2Data]', err);
        res.status(500).json({ error: 'Failed to query external database.', details: err.message });
    }
};
