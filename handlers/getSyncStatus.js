/**
 * GET /api/data/sync-status
 * Return the last sync time and status from the SyncState table.
 */
const { query, sql } = require('../db/connection');
const { loadAppConfig } = require('../db/connection');

module.exports = async function getSyncStatus(req, res) {
    try {
        const config = loadAppConfig();
        const refreshInterval = 5; // default minutes

        const result = await query('SELECT TOP 1 * FROM SyncState WHERE Id = 1');

        if (result.recordset.length === 0) {
            return res.json({
                lastSyncTime: null,
                initialLoadComplete: false,
                nextRefreshInMinutes: refreshInterval,
            });
        }

        const state = result.recordset[0];

        res.json({
            lastSyncTime: state.LastSyncTime ? state.LastSyncTime.toISOString() : null,
            initialLoadComplete: !!state.InitialLoadComplete,
            nextRefreshInMinutes: refreshInterval,
        });
    } catch (err) {
        console.error('[getSyncStatus]', err);
        res.status(500).json({ error: 'Failed to fetch sync status.', details: err.message });
    }
};
