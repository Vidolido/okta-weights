# OKTA Weights Project — Memory & Progress

## What This Project Is
A web dashboard for displaying truck weighing data at a fuel company (OKTA). Trucks come for **Loading** (buying fuel) and **Unloading** (delivering fuel). Each truck gets weighed twice — before and after — and the net weight is calculated.

## Tech Stack
- **Backend:** Node.js + Express.js (port 6969)
- **Frontend:** PUG templates + vanilla JS + custom CSS
- **Database:** SQL Server (when deployed on company network)
- **Data pipeline:** API → Excel JSON → Database (cascading fallback)

## Project Location
- Repo: `git@github.com:Vidolido/okta-weights.git`
- Local: `/home/vido/projects/okta-d-project/`
- Original C# reference: `/home/vido/projects/OktaData/`
- Reference materials: `_material/` (explanation.txt, Excel file, kpi_data.json)

## File Structure
```
okta-d-project/
├── server.js                  # Express app, routes, startup
├── config.json                # API credentials + DB settings + UI config
├── package.json
├── .gitignore
├── db/
│   └── connection.js          # SQL Server connection pool (mssql package)
├── services/
│   ├── apiClient.js           # Connects to OKTA API (https://okta-truck-lu/)
│   ├── kpiProcessor.js        # Processes raw events into KPI records (ported from C#)
│   └── dataLoader.js          # Startup orchestrator: API → Excel JSON → DB fallback
├── handlers/
│   ├── getKpiData.js          # DB-based KPI handler (legacy, not used currently)
│   ├── getUnload2Data.js      # External linked DB handler (legacy, not used currently)
│   ├── getSyncStatus.js       # DB sync status (legacy)
│   ├── exportCsv.js           # CSV export from DB (legacy)
│   ├── exportExcel.js         # Excel export from DB (legacy)
│   ├── exportUnload2Csv.js    # Unload2 CSV export (legacy)
│   └── exportUnload2Excel.js  # Unload2 Excel export (legacy)
├── views/
│   └── index.pug              # Single-page layout
├── public/
│   ├── css/style.css          # Custom CSS (dark blue navbar, clean tables)
│   └── js/app.js              # Client-side vanilla JS
└── _material/
    ├── explanation.txt         # Original developer's instructions
    ├── Okta_EventDump_ProofOfConce222222pt.xlsm  # Excel with raw data + KPI sheet
    └── kpi_data.json           # Pre-parsed 386 records (for fast loading)
```

## Data Flow (Current State)
1. **On startup**, `dataLoader.js` tries in order:
   - **API** (`https://okta-truck-lu/open-api/`) — fails on dev machine (not on company network)
   - **Excel JSON** (`_material/kpi_data.json`) — loads instantly, 386 records
   - **Database** (SQL Server `localhost\sqlexpress`) — not available on dev machine
2. Data is held **in memory** and served via `/api/data/kpi` with filtering/sorting/pagination
3. Frontend fetches from API and renders tables

## Current Data (from Excel KPI sheet)
- **318 Loading** records (trucks buying fuel)
- **39 Unloading** records (trucks delivering fuel)
- **29** records with empty workOrderType
- Date range: around 2026-03-29 to 2026-04-01

## Data Columns (per record)
| Column | Description | Load | Unload |
|--------|-------------|------|--------|
| driver | Driver name | ✅ | ✅ |
| licensePlate | Truck plate(s) | ✅ | ✅ |
| status | Session status (open/closed) | ✅ | ✅ |
| sessionCreationTime | When session started | ✅ | ✅ |
| sessionClosingTime | When session ended | ✅ | ✅ |
| derivate | Material name (ULSD, JET FUEL, UNL 95, etc.) | ✅ | ✅ |
| derivateQty | Material quantity from SMS message | ✅ | ✅ |
| smsNotificationTime | When SMS was sent to driver | ✅ | ✅ |
| firstWeighingTime | 1st weighing timestamp | ✅ | ✅ |
| firstWeighingKg | 1st weighing weight | ✅ | ✅ |
| secondWeighingTime | 2nd weighing timestamp | ✅ | ✅ |
| secondWeighingKg | 2nd weighing weight | ✅ | ✅ |
| netQuantityKg | Net weight (|2nd - 1st|) | ✅ (Loaded) | ✅ (Unloaded) |
| barrierEntranceTime | Barrier entry time | ❌ | ✅ |
| barrierExitTime | Barrier exit time | ❌ | ✅ |

## Frontend Features (Working)
- **Loading / Unloading** tabs
- **Search** bar (driver, plate, weight)
- **Date filter** (from/to + Apply)
- **Clear Filters** button
- **Sort** by clicking column headers
- **Pagination** (top + bottom, 50 rows/page)
- **Column visibility** modal (per-tab, persisted to localStorage)
- **Export** dropdown (CSV/Excel) — currently wired to DB handlers, needs update for in-memory data
- **Cache busting** on JS/CSS files

## Key Decisions Made
- Tab labels: "Loading" / "Unloading" (per instructions, not "Load"/"Unload")
- No Tailwind — custom CSS ported from original
- No TypeScript — plain JS
- In-memory data store for now (no DB writes)
- Pre-parsed JSON for fast startup (Excel parsing takes ~30s, JSON is instant)
- `Materials & Quantities` column was split into `derivate` (name) + `derivateQty` (number)
- Junk text (KONTROLNO, phone numbers, messages) stripped from material names
- Multi-material entries handled (semicolon-separated)

## API Details (from config.json)
- Base URL: `https://okta-truck-lu/`
- Auth: POST `/open-api/auth` with clientId + clientSecretHash
- Sessions: GET `/open-api/sessions?modFrom={date}`
- Events: GET `/open-api/session/events?parent_id={sessionId}`
- API Key: 11, ClientId: admin
- ClientSecretHash: `7db132bc98c2bcc6727ca45f7d305d83ace778a3cb2b3be9c34db9babc50830e378f5bf92041d3e0a3e700ccb611531dceb1002c844d6aac760e56c4859c6666`

## Original System Architecture (for reference)
The original C# app had 3 components:
1. **OktaData.Sync** — Windows service that pulls from API, processes events into KPIs, stores in SQL Server
2. **OktaData.Web** — ASP.NET Core web dashboard
3. **OktaData.Common** — Shared models, DB context, KPI processor, API client

The original had **3 tabs**: Load, Unload, Unload2. Unload2 was a separate external database (W2DataTable on server 10.25.1.117) that the original dev couldn't merge with the API data. We currently don't show Unload2.

## External Database (not connected yet)
- Server: 10.25.1.117
- DB: LEWISDB_6W.MDF
- Table: dbo.W2DataTable
- Columns: File6_Data1 (license plate), Weight1, Date1, Weight2, Date2, Net
- This is the physical scale system's database — has simpler weighing records
- The "merge problem" was matching records between this and the API data by license plate + time

## What Still Needs Work
1. **Export endpoints** — currently wired to DB handlers that won't work with in-memory data. Need to export from the in-memory store.
2. **API connection testing** — when deployed on company network, the API should connect. Need to verify and debug any issues.
3. **Unload2 tab** — not implemented in frontend (backend handler exists for linked server)
4. **Live sync** — currently static data from Excel. When API works, need periodic refresh.
5. **Duration columns** — the KPI sheet has Parking Wait, Driver Response, Operation, Closeout, Total (time durations with green/orange/red color coding). Not implemented yet.

## Git Info
- Branch: main
- Remote: git@github.com:Vidolido/okta-weights.git
- Git user: Goce Levkovski <vido@Vido.Vidolinski>
- GitHub: Vidolido

## Dependencies (package.json)
- express, pug, mssql, json2csv, exceljs, axios
