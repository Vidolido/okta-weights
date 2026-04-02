const sql = require('mssql');
const fs = require('fs');
const path = require('path');

let pool = null;

/**
 * Load database configuration from config.json
 */
function loadDbConfig() {
    const configPath = path.resolve(__dirname, '..', 'config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);

    const db = config.database;

    return {
        server: db.server,
        database: db.database,
        user: db.user || undefined,
        password: db.password || undefined,
        port: db.port || 1433,
        options: {
            encrypt: db.options?.encrypt ?? false,
            trustServerCertificate: db.options?.trustServerCertificate ?? true,
            requestTimeout: db.options?.requestTimeout ?? 120000,
            connectionTimeout: db.options?.connectionTimeout ?? 30000,
        },
        pool: {
            max: db.options?.pool?.max ?? 10,
            min: db.options?.pool?.min ?? 2,
            idleTimeoutMillis: db.options?.pool?.idleTimeoutMillis ?? 30000,
        },
    };
}

/**
 * Get or create the global connection pool
 */
async function getPool() {
    if (pool && pool.connected) {
        return pool;
    }

    try {
        const config = loadDbConfig();
        pool = await sql.connect(config);
        console.log('[DB] Connected to SQL Server:', config.server, '/', config.database);
        return pool;
    } catch (err) {
        console.error('[DB] Connection failed:', err.message);
        pool = null;
        throw err;
    }
}

/**
 * Execute a query and return the result set
 */
async function query(queryString, params = {}) {
    const p = await getPool();
    const request = p.request();

    // Bind parameters
    for (const [key, val] of Object.entries(params)) {
        if (val instanceof Date) {
            request.input(key, sql.DateTime, val);
        } else if (typeof val === 'number' && Number.isInteger(val)) {
            request.input(key, sql.Int, val);
        } else if (typeof val === 'number') {
            request.input(key, sql.Decimal(12, 2), val);
        } else if (typeof val === 'boolean') {
            request.input(key, sql.Bit, val);
        } else {
            request.input(key, sql.NVarChar, val ?? null);
        }
    }

    return request.query(queryString);
}

/**
 * Validate a SQL identifier to prevent injection
 */
function validateSqlIdentifier(value, name) {
    if (!value || typeof value !== 'string') {
        throw new Error(`${name} is not configured.`);
    }
    if (value.includes(']') || value.includes(';') || value.includes('--')) {
        throw new Error(`${name} contains invalid characters.`);
    }
    return value;
}

/**
 * Load the full app config
 */
function loadAppConfig() {
    const configPath = path.resolve(__dirname, '..', 'config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
}

module.exports = { getPool, query, sql, validateSqlIdentifier, loadAppConfig };
