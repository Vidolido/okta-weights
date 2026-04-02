/* ═══════════════════════════════════════════════════════════════════════
   OKTA Truck KPI — app.js
   Vanilla JS dashboard client – no dependencies
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── Column Definitions ─────────────────────────────────────────────
    var COLUMN_DEFS = {
        load: [
            { key: 'LicensePlate',         label: 'License Plate' },
            { key: 'SessionCreationTime',  label: 'Session Creation Time' },
            { key: 'SessionClosingTime',   label: 'Session Closing Time' },
            { key: 'Derivate',             label: 'Derivate' },
            { key: 'SmsNotificationTime',  label: 'SMS Notification Time' },
            { key: 'FirstWeighingTime',    label: '1st Weighing Time' },
            { key: 'FirstWeighingKg',      label: '1st Weighing [kg]' },
            { key: 'SecondWeighingTime',   label: '2nd Weighing Time' },
            { key: 'SecondWeighingKg',     label: '2nd Weighing [kg]' },
            { key: 'NetQuantityKg',        label: 'Loaded Qty [kg]' }
        ],
        unload: [
            { key: 'LicensePlate',         label: 'License Plate' },
            { key: 'SessionCreationTime',  label: 'Session Creation Time' },
            { key: 'SessionClosingTime',   label: 'Session Closing Time' },
            { key: 'Derivate',             label: 'Derivate' },
            { key: 'SmsNotificationTime',  label: 'SMS Notification Time' },
            { key: 'FirstWeighingTime',    label: '1st Weighing Time' },
            { key: 'FirstWeighingKg',      label: '1st Weighing [kg]' },
            { key: 'BarrierEntranceTime',  label: 'Barrier Entrance' },
            { key: 'BarrierExitTime',      label: 'Barrier Exit' },
            { key: 'SecondWeighingTime',   label: '2nd Weighing Time' },
            { key: 'SecondWeighingKg',     label: '2nd Weighing [kg]' },
            { key: 'NetQuantityKg',        label: 'Unloaded Qty [kg]' }
        ]
    };

    // Weight columns
    var KG_COLUMNS = ['FirstWeighingKg', 'SecondWeighingKg', 'NetQuantityKg'];

    // Date-time columns
    var DT_COLUMNS = [
        'SessionCreationTime', 'SessionClosingTime', 'SmsNotificationTime',
        'FirstWeighingTime', 'SecondWeighingTime',
        'BarrierEntranceTime', 'BarrierExitTime'
    ];

    // ── State ──────────────────────────────────────────────────────────
    var currentTab       = 'load';
    var currentPage      = 1;
    var pageSize         = (window.__config && window.__config.defaultRowsPerPage) || 50;
    var defaultDays      = (window.__config && window.__config.defaultDateRangeDays) || 30;
    var sortColumn       = 'SessionCreationTime';
    var sortDirection    = 'desc';
    var startDate        = '';
    var endDate          = '';
    var searchTerm       = '';
    var visibleColumns   = {};
    var syncPollTimer    = null;
    var searchDebounce   = null;

    // ── Initialise ─────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        setDefaultDates();
        loadTabFromStorage();
        loadColumnVisibility();
        switchTab(currentTab);
        updateSyncStatus();
        syncPollTimer = setInterval(updateSyncStatus, 30000);
    });

    // ── Public API (attached to window so onclick works) ───────────────
    window.switchTab            = switchTab;
    window.sort                 = sort;
    window.changePage           = changePage;
    window.applyDateFilter      = applyDateFilter;
    window.onSearch             = onSearch;
    window.toggleColumnPopup    = toggleColumnPopup;
    window.saveColumnVisibility = saveColumnVisibility;
    window.closeColumnPopup     = closeColumnPopup;
    window.exportData           = exportData;

    // ── Search ─────────────────────────────────────────────────────────
    function onSearch() {
        var input = document.getElementById('searchInput');
        searchTerm = (input ? input.value : '').trim();

        // Debounce 300ms
        if (searchDebounce) clearTimeout(searchDebounce);
        searchDebounce = setTimeout(function () {
            currentPage = 1;
            fetchData();
        }, 300);
    }

    // ── Tab Switching ──────────────────────────────────────────────────
    function switchTab(tab) {
        currentTab = tab;
        currentPage = 1;
        sortColumn = 'SessionCreationTime';
        sortDirection = 'desc';

        // Update tab button states
        var buttons = document.querySelectorAll('.tab-btn');
        buttons.forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
        });

        // Show / hide tab content
        ['load', 'unload'].forEach(function (t) {
            var el = document.getElementById('tabContent-' + t);
            if (el) el.style.display = (t === tab) ? '' : 'none';
        });

        populateColumnCheckboxes();
        loadColumnVisibility();
        fetchData();

        // Persist tab
        try { localStorage.setItem('oktadata_tab', tab); } catch (e) { }
    }

    // ── Date Handling ──────────────────────────────────────────────────
    function setDefaultDates() {
        var today = new Date();
        var start = new Date();
        start.setDate(start.getDate() - defaultDays);

        startDate = formatDateISO(start);
        endDate   = formatDateISO(today);

        document.getElementById('startDate').value = startDate;
        document.getElementById('endDate').value   = endDate;
    }

    function applyDateFilter() {
        var s = document.getElementById('startDate').value;
        var e = document.getElementById('endDate').value;

        if (!s || !e) return;

        if (s > e) {
            alert('Start date must be before or equal to end date.');
            return;
        }

        startDate = s;
        endDate   = e;

        try {
            localStorage.setItem('oktadata_startDate', s);
            localStorage.setItem('oktadata_endDate', e);
        } catch (ex) { }

        currentPage = 1;
        fetchData();
    }

    function loadDatesFromStorage() {
        try {
            var s = localStorage.getItem('oktadata_startDate');
            var e = localStorage.getItem('oktadata_endDate');
            if (s && e) {
                startDate = s;
                endDate   = e;
                document.getElementById('startDate').value = s;
                document.getElementById('endDate').value   = e;
            }
        } catch (ex) { }
    }

    // ── Column Visibility ──────────────────────────────────────────────
    function loadColumnVisibility() {
        try {
            var stored = localStorage.getItem('oktadata_columns_' + currentTab);
            if (stored) {
                visibleColumns[currentTab] = JSON.parse(stored);
                if (!Array.isArray(visibleColumns[currentTab]) || visibleColumns[currentTab].length === 0) {
                    visibleColumns[currentTab] = null;
                }
            }
        } catch (e) { }

        if (!visibleColumns[currentTab]) {
            visibleColumns[currentTab] = COLUMN_DEFS[currentTab].map(function (c) { return c.key; });
        }

        updateCheckboxStates();
    }

    function saveColumnVisibility() {
        var checked = [];
        var checkboxes = document.querySelectorAll('#columnCheckboxes input[type="checkbox"]');
        checkboxes.forEach(function (cb) {
            if (cb.checked) checked.push(cb.value);
        });

        visibleColumns[currentTab] = checked.length > 0 ? checked : COLUMN_DEFS[currentTab].map(function (c) { return c.key; });

        try { localStorage.setItem('oktadata_columns_' + currentTab, JSON.stringify(visibleColumns[currentTab])); } catch (e) { }

        fetchData();
    }

    function toggleColumnPopup() {
        var modal = document.getElementById('columnModal');
        modal.classList.toggle('show');
        if (modal.classList.contains('show')) {
            populateColumnCheckboxes();
            updateCheckboxStates();
        }
    }

    function closeColumnPopup(event) {
        if (event && event.target !== event.currentTarget) return;
        var modal = document.getElementById('columnModal');
        modal.classList.remove('show');
    }

    function populateColumnCheckboxes() {
        var container = document.getElementById('columnCheckboxes');
        container.innerHTML = '';

        var defs = COLUMN_DEFS[currentTab] || [];
        defs.forEach(function (col) {
            var label = document.createElement('label');
            var cb    = document.createElement('input');
            cb.type   = 'checkbox';
            cb.value  = col.key;

            var span  = document.createElement('span');
            span.textContent = col.label;

            label.appendChild(cb);
            label.appendChild(span);
            container.appendChild(label);
        });
    }

    function updateCheckboxStates() {
        var cols = visibleColumns[currentTab] || [];
        var checkboxes = document.querySelectorAll('#columnCheckboxes input[type="checkbox"]');
        checkboxes.forEach(function (cb) {
            cb.checked = cols.indexOf(cb.value) !== -1;
        });
    }

    function loadTabFromStorage() {
        loadDatesFromStorage();
        try {
            var tab = localStorage.getItem('oktadata_tab');
            if (tab && (tab === 'load' || tab === 'unload')) {
                currentTab = tab;
            }
        } catch (e) { }
    }

    // ── Sorting ────────────────────────────────────────────────────────
    function sort(column) {
        if (sortColumn === column) {
            sortDirection = (sortDirection === 'asc') ? 'desc' : 'asc';
        } else {
            sortColumn    = column;
            sortDirection = 'asc';
        }
        currentPage = 1;
        fetchData();
    }

    // ── Pagination ─────────────────────────────────────────────────────
    function changePage(page) {
        currentPage = page;
        fetchData();
    }

    // ── Fetch Data ─────────────────────────────────────────────────────
    function fetchData() {
        var cols = (visibleColumns[currentTab] || []).join(',');

        var url = '/api/data/kpi'
            + '?type='            + encodeURIComponent(currentTab)
            + '&startDate='       + encodeURIComponent(startDate)
            + '&endDate='         + encodeURIComponent(endDate)
            + '&page='            + currentPage
            + '&pageSize='        + pageSize
            + '&sortColumn='      + encodeURIComponent(sortColumn)
            + '&sortDirection='   + encodeURIComponent(sortDirection)
            + '&columns='         + encodeURIComponent(cols)
            + '&search='          + encodeURIComponent(searchTerm);

        // Show loading
        var tbody = document.getElementById('tbody-' + currentTab);
        if (tbody) {
            tbody.innerHTML = '<tr><td class="empty-row" colspan="99"><span class="loading-spinner"></span>Loading data...</td></tr>';
        }

        fetch(url)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                renderTable(data);
            })
            .catch(function (err) {
                if (tbody) {
                    tbody.innerHTML = '<tr><td class="empty-row" colspan="99">Error loading data: ' + escapeHtml(err.message) + '</td></tr>';
                }
            });
    }

    // ── Render Table ───────────────────────────────────────────────────
    function renderTable(response) {
        var cols = visibleColumns[currentTab] || COLUMN_DEFS[currentTab].map(function (c) { return c.key; });
        var defMap = {};
        (COLUMN_DEFS[currentTab] || []).forEach(function (d) { defMap[d.key] = d.label; });

        // Render thead
        var thead = document.getElementById('thead-' + currentTab);
        if (thead) {
            var html = '<tr>';
            cols.forEach(function (key) {
                var label = defMap[key] || key;
                var cls = 'sortable';
                if (sortColumn === key) cls += ' sort-' + sortDirection;
                html += '<th class="' + cls + '" onclick="sort(\'' + escapeAttr(key) + '\')">'
                    + escapeHtml(label)
                    + ' <span class="sort-arrow"></span></th>';
            });
            html += '</tr>';
            thead.innerHTML = html;
        }

        // Render tbody
        var tbody = document.getElementById('tbody-' + currentTab);
        if (!tbody) return;

        if (!response.data || response.data.length === 0) {
            tbody.innerHTML = '<tr><td class="empty-row" colspan="' + cols.length + '">No data found.</td></tr>';
            renderPagination(response.totalRecords || 0, response.page || 1, response.pageSize || pageSize);
            return;
        }

        var html = '';
        response.data.forEach(function (row) {
            html += '<tr>';
            cols.forEach(function (key) {
                var raw = row[key];
                var display = formatCellValue(raw, key);
                html += '<td>' + escapeHtml(display) + '</td>';
            });
            html += '</tr>';
        });
        tbody.innerHTML = html;

        renderPagination(response.totalRecords, response.page, response.pageSize);
    }

    // ── Render Pagination ──────────────────────────────────────────────
    function renderPagination(totalRecords, page, pSize) {
        var totalPages = Math.ceil(totalRecords / pSize) || 1;
        var startRec   = totalRecords === 0 ? 0 : (page - 1) * pSize + 1;
        var endRec     = Math.min(page * pSize, totalRecords);

        var html = '<span class="pagination-info">'
            + 'Page ' + page + ' of ' + totalPages
            + ' &nbsp;|&nbsp; Showing ' + startRec + '\u2013' + endRec + ' of ' + totalRecords + ' records'
            + '</span>';

        // Prev
        html += '<button class="pagination-btn" onclick="changePage(' + (page - 1) + ')"'
            + (page <= 1 ? ' disabled' : '') + '>&laquo;</button>';

        // Page numbers (max 7 visible)
        var pages = getPageNumbers(page, totalPages, 7);
        pages.forEach(function (p) {
            if (p === '...') {
                html += '<span class="pagination-ellipsis">&hellip;</span>';
            } else {
                html += '<button class="pagination-btn' + (p === page ? ' active' : '') + '" onclick="changePage(' + p + ')">' + p + '</button>';
            }
        });

        // Next
        html += '<button class="pagination-btn" onclick="changePage(' + (page + 1) + ')"'
            + (page >= totalPages ? ' disabled' : '') + '>&raquo;</button>';

        // Apply to both top and bottom
        ['top', 'bottom'].forEach(function (pos) {
            var el = document.getElementById('pagination-' + pos + '-' + currentTab);
            if (el) el.innerHTML = html;
        });
    }

    function getPageNumbers(current, total, maxVisible) {
        if (total <= maxVisible) {
            var arr = [];
            for (var i = 1; i <= total; i++) arr.push(i);
            return arr;
        }

        var pages = [];
        var half  = Math.floor((maxVisible - 2) / 2);

        var start = Math.max(2, current - half);
        var end   = Math.min(total - 1, current + half);

        if (current - half < 2) end = Math.min(total - 1, maxVisible - 1);
        if (current + half > total - 1) start = Math.max(2, total - maxVisible + 2);

        pages.push(1);
        if (start > 2) pages.push('...');
        for (var j = start; j <= end; j++) pages.push(j);
        if (end < total - 1) pages.push('...');
        pages.push(total);

        return pages;
    }

    // ── Cell Formatting ────────────────────────────────────────────────
    function formatCellValue(value, columnKey) {
        if (value === null || value === undefined || value === '') return '';

        // ISO date string from server
        if (typeof value === 'string') {
            if (DT_COLUMNS.indexOf(columnKey) !== -1 && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
                return formatDateTimeString(value);
            }
            if (KG_COLUMNS.indexOf(columnKey) !== -1 && !isNaN(parseFloat(value))) {
                return formatNumber(parseFloat(value));
            }
            return value;
        }

        if (typeof value === 'number') {
            if (KG_COLUMNS.indexOf(columnKey) !== -1) {
                return formatNumber(value);
            }
            if (DT_COLUMNS.indexOf(columnKey) !== -1) {
                return formatDateTimeString(new Date(value).toISOString());
            }
            return String(value);
        }

        return String(value);
    }

    function formatDateTimeString(isoStr) {
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return isoStr;
            var dd = String(d.getDate()).padStart(2, '0');
            var mm = String(d.getMonth() + 1).padStart(2, '0');
            var yy = d.getFullYear();
            var hh = String(d.getHours()).padStart(2, '0');
            var mi = String(d.getMinutes()).padStart(2, '0');
            return dd + '-' + mm + '-' + yy + ' ' + hh + ':' + mi;
        } catch (e) {
            return isoStr;
        }
    }

    function formatNumber(num) {
        if (num === null || num === undefined) return '';
        return Math.round(num).toLocaleString('en-US');
    }

    // ── Export ─────────────────────────────────────────────────────────
    function exportData(format) {
        var cols = (visibleColumns[currentTab] || []).join(',');
        var url = '/api/export/' + format
            + '?type='          + encodeURIComponent(currentTab)
            + '&startDate='     + encodeURIComponent(startDate)
            + '&endDate='       + encodeURIComponent(endDate)
            + '&columns='       + encodeURIComponent(cols);

        window.open(url, '_blank');
    }

    // ── Sync Status ────────────────────────────────────────────────────
    function updateSyncStatus() {
        var el = document.getElementById('syncStatusText');
        if (!el) return;

        fetch('/api/data/sync-status')
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (!data.initialLoadComplete) {
                    el.innerHTML = '<span class="loading">Initial data loading...</span>';
                } else if (data.lastSyncTime) {
                    var d = new Date(data.lastSyncTime);
                    var timeStr = d.toLocaleString('en-GB');
                    el.textContent = 'Last refreshed: ' + timeStr + ' | Next refresh in ' + (data.nextRefreshInMinutes || 5) + ' min';
                } else {
                    el.textContent = 'No sync data available yet.';
                }
            })
            .catch(function () {
                el.textContent = 'Unable to retrieve sync status.';
            });
    }

    // ── Utility ────────────────────────────────────────────────────────
    function formatDateISO(date) {
        var dd = String(date.getDate()).padStart(2, '0');
        var mm = String(date.getMonth() + 1).padStart(2, '0');
        var yy = date.getFullYear();
        return yy + '-' + mm + '-' + dd;
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/'/g, "\\'")
            .replace(/"/g, '&quot;');
    }

})();
