/**
 * GET /api/data/kpi
 * Fetch KPI data for load or unload type with pagination, sorting, filtering.
 */
const { query, sql, loadAppConfig } = require('../db/connection');

// Allowed sort columns (prevent injection)
const SORT_COLUMNS = {
    LicensePlate: 'LicensePlate',
    Driver: 'Driver',
    SessionCreationTime: 'SessionCreationTime',
    SessionClosingTime: 'SessionClosingTime',
    Derivate: 'Derivate',
    SmsNotificationTime: 'SmsNotificationTime',
    FirstWeighingTime: 'FirstWeighingTime',
    FirstWeighingKg: 'FirstWeighingKg',
    SecondWeighingTime: 'SecondWeighingTime',
    SecondWeighingKg: 'SecondWeighingKg',
    NetQuantityKg: 'NetQuantityKg',
    BarrierEntranceTime: 'BarrierEntranceTime',
    BarrierExitTime: 'BarrierExitTime',
};

// Column display names
const COLUMN_DISPLAY = {
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

module.exports = async function getKpiData(req, res) {
    try {
        const config = loadAppConfig();
        const ui = config.ui || {};
        const defaultDateRangeDays = ui.defaultDateRangeDays || 30;
        const dataRetentionDays = ui.dataRetentionDays || 365;

        // --- Params ---
        const type = req.query.type;
        if (type !== 'load' && type !== 'unload') {
            return res.status(400).json({ error: "type must be 'load' or 'unload'" });
        }

        let page = Math.max(1, parseInt(req.query.page) || 1);
        let pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize) || 50));
        const sortColumn = SORT_COLUMNS[req.query.sortColumn] || 'SessionCreationTime';
        const sortDir = req.query.sortDirection === 'asc' ? 'ASC' : 'DESC';
        const columnsParam = req.query.columns || '';
        const searchTerm = (req.query.search || '').trim();

        // Date range
        const now = new Date();
        const startDefault = new Date(now);
        startDefault.setDate(startDefault.getDate() - defaultDateRangeDays);
        const endDefault = new Date(now);
        endDefault.setDate(endDefault.getDate() + 1);

        const startDate = req.query.startDate ? new Date(req.query.startDate) : startDefault;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : endDefault;

        // Retention cutoff
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - dataRetentionDays);

        // Parse requested columns
        let requestedCols = columnsParam
            ? columnsParam.split(',').map(c => c.trim()).filter(c => SORT_COLUMNS[c])
            : null;

        if (!requestedCols || requestedCols.length === 0) {
            requestedCols = type === 'load' ? [...LOAD_COLUMNS] : [...UNLOAD_COLUMNS];
        }

        // --- Build WHERE clause ---
        const conditions = [
            'WorkOrderType = @type',
            'SessionCreationTime >= @startDate',
            'SessionCreationTime < @endDate',
            'SessionCreationTime >= @cutoff',
        ];

        // Search filter
        if (searchTerm) {
            conditions.push(
                `(Driver LIKE @search OR LicensePlate LIKE @search OR CAST(NetQuantityKg AS NVARCHAR(50)) LIKE @search)`
            );
        }

        const whereClause = conditions.join(' AND ');

        // --- Count query ---
        const countSql = `SELECT COUNT(*) AS total FROM KPIs WHERE ${whereClause}`;
        const countResult = await query(countSql, {
            type,
            startDate,
            endDate,
            cutoff,
            search: searchTerm ? `%${searchTerm}%` : null,
        });
        const totalRecords = countResult.recordset[0].total;

        // --- Data query ---
        const dataSql = `
            SELECT * FROM KPIs
            WHERE ${whereClause}
            ORDER BY ${sortColumn} ${sortDir}
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
        `;
        const dataResult = await query(dataSql, {
            type,
            startDate,
            endDate,
            cutoff,
            search: searchTerm ? `%${searchTerm}%` : null,
            offset: (page - 1) * pageSize,
            pageSize,
        });

        // Project to requested columns
        const data = dataResult.recordset.map(row => {
            const obj = {};
            for (const col of requestedCols) {
                let val = row[col];
                // Format dates as ISO strings for the frontend
                if (val instanceof Date) {
                    val = val.toISOString();
                }
                obj[col] = val;
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
        console.error('[getKpiData]', err);
        res.status(500).json({ error: 'Failed to fetch KPI data.', details: err.message });
    }
};
