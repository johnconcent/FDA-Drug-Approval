/* ============================================
   FDA Drug Approval Timeline — App Logic
   ============================================ */

(function () {
    'use strict';

    // ---- Category colors (colorblind-friendly palette) ----
    const CATEGORY_COLORS = {
        'Oncology':           '#00d4ff',
        'Anti-Infective':     '#ff9f43',
        'CNS/Neurology':      '#ff6b6b',
        'Cardiovascular':     '#54e0a0',
        'Endocrine/Metabolic':'#a78bfa',
        'Dermatology':        '#f472b6',
        'Gastrointestinal':   '#fbbf24',
        'Hematology':         '#ef4444',
        'Immunology':         '#38bdf8',
        'Respiratory':        '#34d399',
        'Ophthalmology':      '#c084fc',
        'Renal/Urology':      '#fb923c',
        "Women's Health":     '#f9a8d4',
        'Other':              '#64748b',
        'Injectable':         '#94a3b8',
        'Oral Formulation':   '#cbd5e1'
    };

    const DECADES = [1980, 1990, 2000, 2010, 2020];

    // ---- State ----
    let allData = [];
    let currentView = 'scatter';
    let filters = {
        decade: 'all',
        review: 'all',
        nmeOnly: true,
        categories: new Set(),
        search: ''
    };
    let allCategories = [];

    // ---- DOM refs ----
    const $plotArea = document.getElementById('plotArea');
    const $searchBox = document.getElementById('searchBox');
    const $nmeToggle = document.getElementById('nmeToggle');
    const $statTotal = document.getElementById('statTotal');
    const $statMedian = document.getElementById('statMedian');
    const $decadeTable = document.getElementById('decadeTable');
    const $fastestList = document.getElementById('fastestList');
    const $slowestList = document.getElementById('slowestList');
    const $categoryBreakdown = document.getElementById('categoryBreakdown');
    const $categoryFilters = document.getElementById('categoryFilters');
    const $legendBar = document.getElementById('legendBar');
    const $loadingOverlay = document.getElementById('loadingOverlay');

    // ---- Utilities ----
    function median(arr) {
        if (!arr.length) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function getDecade(year) {
        return Math.floor(year / 10) * 10;
    }

    function normalizeReview(r) {
        if (!r) return 'unknown';
        const lower = r.toLowerCase();
        if (lower.includes('priority')) return 'priority';
        if (lower.includes('standard')) return 'standard';
        return 'unknown';
    }

    function getFilteredData() {
        return allData.filter(d => {
            if (filters.nmeOnly && !d.isNME) return false;
            if (filters.decade !== 'all' && getDecade(d.approvalYear) !== parseInt(filters.decade)) return false;
            if (filters.review !== 'all' && normalizeReview(d.reviewDesignation) !== filters.review) return false;
            if (filters.categories.size > 0 && !filters.categories.has(d.category)) return false;
            if (filters.search) {
                const q = filters.search.toLowerCase();
                if (!d.drugName.toLowerCase().includes(q) &&
                    !(d.activeIngredient && d.activeIngredient.toLowerCase().includes(q))) return false;
            }
            return true;
        });
    }

    // ---- Polynomial regression (degree 3) ----
    function polyfit(xs, ys, degree) {
        const n = xs.length;
        const size = degree + 1;

        // Build Vandermonde-ish normal equations
        const X = [];
        for (let i = 0; i < n; i++) {
            const row = [];
            for (let j = 0; j < size; j++) {
                row.push(Math.pow(xs[i], j));
            }
            X.push(row);
        }

        // X^T * X
        const XtX = Array.from({ length: size }, () => new Array(size).fill(0));
        const XtY = new Array(size).fill(0);

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < size; j++) {
                XtY[j] += X[i][j] * ys[i];
                for (let k = 0; k < size; k++) {
                    XtX[j][k] += X[i][j] * X[i][k];
                }
            }
        }

        // Gauss elimination
        const A = XtX.map((row, i) => [...row, XtY[i]]);
        for (let col = 0; col < size; col++) {
            let maxRow = col;
            for (let row = col + 1; row < size; row++) {
                if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
            }
            [A[col], A[maxRow]] = [A[maxRow], A[col]];
            if (Math.abs(A[col][col]) < 1e-12) continue;
            for (let row = 0; row < size; row++) {
                if (row === col) continue;
                const f = A[row][col] / A[col][col];
                for (let j = col; j <= size; j++) {
                    A[row][j] -= f * A[col][j];
                }
            }
        }

        return A.map((row, i) => row[size] / row[i]);
    }

    function polyeval(coeffs, x) {
        let y = 0;
        for (let i = 0; i < coeffs.length; i++) {
            y += coeffs[i] * Math.pow(x, i);
        }
        return y;
    }

    // ---- Render scatter ----
    function renderScatter(data) {
        // Group by category
        const groups = {};
        data.forEach(d => {
            if (!groups[d.category]) groups[d.category] = [];
            groups[d.category].push(d);
        });

        const traces = [];
        const sortedCats = Object.keys(groups).sort();

        sortedCats.forEach(cat => {
            const items = groups[cat];
            const color = CATEGORY_COLORS[cat] || '#64748b';
            traces.push({
                x: items.map(d => d.approvalYear + (Math.random() - 0.5) * 0.3),
                y: items.map(d => d.monthsToApproval),
                text: items.map(d =>
                    `<b>${d.drugName}</b><br>` +
                    `${d.activeIngredient || '—'}<br>` +
                    `<b>Category:</b> ${d.category}<br>` +
                    `<b>Approved:</b> ${d.approvalDate}<br>` +
                    `<b>Time:</b> ${d.monthsToApproval} months<br>` +
                    `<b>Review:</b> ${d.reviewDesignation || '—'}`
                ),
                mode: 'markers',
                type: 'scattergl',
                name: cat,
                marker: {
                    color: color,
                    size: 5.5,
                    opacity: 0.75,
                    line: { width: 0.3, color: 'rgba(255,255,255,0.1)' }
                },
                hovertemplate: '%{text}<extra></extra>',
                hoverlabel: {
                    bgcolor: '#0e1d33',
                    bordercolor: color,
                    font: {
                        family: 'JetBrains Mono, monospace',
                        size: 11,
                        color: '#e8edf5'
                    }
                }
            });
        });

        // Trend line
        if (data.length > 10) {
            const xs = data.map(d => d.approvalYear);
            const ys = data.map(d => d.monthsToApproval);
            // Center years for numerical stability
            const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
            const xsCentered = xs.map(x => x - xMean);
            const coeffs = polyfit(xsCentered, ys, 3);

            const minX = xs.reduce((a, b) => Math.min(a, b), Infinity);
            const maxX = xs.reduce((a, b) => Math.max(a, b), -Infinity);
            const trendXs = [];
            const trendYs = [];
            for (let x = minX; x <= maxX; x += 0.5) {
                const y = polyeval(coeffs, x - xMean);
                if (y >= 0 && y < 200) {
                    trendXs.push(x);
                    trendYs.push(y);
                }
            }

            traces.push({
                x: trendXs,
                y: trendYs,
                mode: 'lines',
                type: 'scatter',
                name: 'Trend (background)',
                line: {
                    color: 'rgba(255, 159, 67, 0.15)',
                    width: 10
                },
                hoverinfo: 'skip',
                showlegend: false
            });

            traces.push({
                x: trendXs,
                y: trendYs,
                mode: 'lines',
                type: 'scatter',
                name: 'Trend',
                line: {
                    color: '#ff9f43',
                    width: 3,
                    dash: 'dash'
                },
                hoverinfo: 'skip',
                showlegend: false
            });
        }

        // Highlight search result
        if (filters.search) {
            const q = filters.search.toLowerCase();
            const matched = data.filter(d =>
                d.drugName.toLowerCase().includes(q) ||
                (d.activeIngredient && d.activeIngredient.toLowerCase().includes(q))
            );
            if (matched.length > 0 && matched.length <= 50) {
                traces.push({
                    x: matched.map(d => d.approvalYear),
                    y: matched.map(d => d.monthsToApproval),
                    text: matched.map(d =>
                        `<b>${d.drugName}</b><br>` +
                        `${d.activeIngredient || '—'}<br>` +
                        `<b>Category:</b> ${d.category}<br>` +
                        `<b>Approved:</b> ${d.approvalDate}<br>` +
                        `<b>Time:</b> ${d.monthsToApproval} months<br>` +
                        `<b>Review:</b> ${d.reviewDesignation || '—'}`
                    ),
                    mode: 'markers',
                    type: 'scatter',
                    name: 'Search Results',
                    marker: {
                        color: '#ffffff',
                        size: 12,
                        symbol: 'diamond',
                        line: { color: '#ff9f43', width: 2 }
                    },
                    hovertemplate: '%{text}<extra></extra>',
                    hoverlabel: {
                        bgcolor: '#0e1d33',
                        bordercolor: '#ff9f43',
                        font: {
                            family: 'JetBrains Mono, monospace',
                            size: 11,
                            color: '#e8edf5'
                        }
                    }
                });
            }
        }

        const layout = {
            paper_bgcolor: '#0a1628',
            plot_bgcolor: '#0a1628',
            margin: { t: 40, r: 30, b: 60, l: 65 },
            xaxis: {
                title: {
                    text: 'Approval Year',
                    font: { family: 'DM Sans, sans-serif', size: 13, color: '#8a9bb5' }
                },
                color: '#556580',
                gridcolor: 'rgba(0, 212, 255, 0.05)',
                gridwidth: 1,
                tickfont: { family: 'JetBrains Mono, monospace', size: 10, color: '#556580' },
                dtick: 5,
                zeroline: false
            },
            yaxis: {
                title: {
                    text: 'Months to Approval',
                    font: { family: 'DM Sans, sans-serif', size: 13, color: '#8a9bb5' }
                },
                color: '#556580',
                gridcolor: 'rgba(0, 212, 255, 0.05)',
                gridwidth: 1,
                tickfont: { family: 'JetBrains Mono, monospace', size: 10, color: '#556580' },
                zeroline: false,
                rangemode: 'tozero'
            },
            showlegend: false,
            hovermode: 'closest',
            dragmode: 'zoom',
            font: {
                family: 'JetBrains Mono, monospace'
            },
            annotations: [{
                x: 0.99,
                y: 0.99,
                xref: 'paper',
                yref: 'paper',
                text: `n = ${data.length.toLocaleString()} drugs`,
                showarrow: false,
                font: { family: 'JetBrains Mono, monospace', size: 11, color: '#556580' },
                xanchor: 'right',
                yanchor: 'top',
                bgcolor: 'rgba(10, 22, 40, 0.6)',
                borderpad: 4
            }]
        };

        const config = {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
            toImageButtonOptions: {
                format: 'png',
                filename: 'fda_approval_scatter'
            }
        };

        Plotly.react($plotArea, traces, layout, config);
    }

    // ---- Render histogram ----
    function renderHistogram(data) {
        const months = data.map(d => d.monthsToApproval).filter(m => m != null && m >= 0);
        const med = median(months);
        const maxVal = Math.min(150, months.reduce((a, b) => Math.max(a, b), 0));

        const traces = [{
            x: months.filter(m => m <= 150),
            type: 'histogram',
            xbins: { start: 0, end: 150, size: 3 },
            marker: {
                color: 'rgba(0, 212, 255, 0.5)',
                line: { color: 'rgba(0, 212, 255, 0.75)', width: 0.5 }
            },
            hovertemplate: '<b>%{x:.0f} months</b><br>Count: %{y}<extra></extra>',
            hoverlabel: {
                bgcolor: '#0e1d33',
                bordercolor: '#00d4ff',
                font: {
                    family: 'JetBrains Mono, monospace',
                    size: 11,
                    color: '#e8edf5'
                }
            },
            name: 'Distribution'
        }];

        const layout = {
            paper_bgcolor: '#0a1628',
            plot_bgcolor: '#0a1628',
            margin: { t: 40, r: 30, b: 60, l: 65 },
            xaxis: {
                title: {
                    text: 'Months to Approval',
                    font: { family: 'DM Sans, sans-serif', size: 13, color: '#8a9bb5' }
                },
                color: '#556580',
                gridcolor: 'rgba(0, 212, 255, 0.05)',
                tickfont: { family: 'JetBrains Mono, monospace', size: 10, color: '#556580' },
                range: [0, 120],
                zeroline: false
            },
            yaxis: {
                title: {
                    text: 'Number of Drugs',
                    font: { family: 'DM Sans, sans-serif', size: 13, color: '#8a9bb5' }
                },
                color: '#556580',
                gridcolor: 'rgba(0, 212, 255, 0.05)',
                tickfont: { family: 'JetBrains Mono, monospace', size: 10, color: '#556580' },
                zeroline: false
            },
            shapes: [{
                type: 'line',
                x0: med, x1: med,
                y0: 0, y1: 1,
                yref: 'paper',
                line: { color: '#ff9f43', width: 2, dash: 'dash' }
            }],
            annotations: [{
                x: med,
                y: 1,
                yref: 'paper',
                text: `Median: ${med.toFixed(1)} mo`,
                showarrow: false,
                font: { family: 'JetBrains Mono, monospace', size: 11, color: '#ff9f43' },
                yanchor: 'bottom',
                xanchor: med > 50 ? 'right' : 'left',
                bgcolor: 'rgba(10, 22, 40, 0.8)',
                borderpad: 4
            }],
            showlegend: false,
            hovermode: 'closest',
            dragmode: 'zoom',
            font: { family: 'JetBrains Mono, monospace' },
            bargap: 0.05
        };

        const config = {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
            toImageButtonOptions: {
                format: 'png',
                filename: 'fda_approval_distribution'
            }
        };

        Plotly.react($plotArea, traces, layout, config);
    }

    // ---- Update sidebar stats ----
    function updateStats(data) {
        // Total + median
        $statTotal.textContent = data.length.toLocaleString();
        const months = data.map(d => d.monthsToApproval);
        $statMedian.textContent = months.length ? median(months).toFixed(1) + ' mo' : '—';

        // Decade medians
        $decadeTable.innerHTML = '';
        const maxMedian = 35;
        DECADES.forEach(dec => {
            const subset = data.filter(d => getDecade(d.approvalYear) === dec);
            const med = subset.length ? median(subset.map(d => d.monthsToApproval)) : null;
            const pct = med !== null ? Math.min(100, (med / maxMedian) * 100) : 0;
            const row = document.createElement('div');
            row.className = 'decade-row';
            row.innerHTML = `
                <span class="decade-label">${dec}s</span>
                <span class="decade-bar"><span class="decade-bar-fill" style="width:${pct}%"></span></span>
                <span class="decade-value" style="color: ${med !== null ? '#00d4ff' : '#556580'}">${med !== null ? med.toFixed(1) + ' mo' : '—'}</span>
            `;
            $decadeTable.appendChild(row);
        });

        // Fastest
        const sorted = [...data].sort((a, b) => a.monthsToApproval - b.monthsToApproval);
        $fastestList.innerHTML = '';
        sorted.slice(0, 5).forEach(d => {
            const el = document.createElement('div');
            el.className = 'record-item fastest';
            el.innerHTML = `<span><span class="rec-name">${d.drugName}</span><span class="rec-year"> (${d.approvalYear})</span></span><span class="rec-months">${d.monthsToApproval} mo</span>`;
            $fastestList.appendChild(el);
        });

        // Slowest
        const sortedDesc = [...data].sort((a, b) => b.monthsToApproval - a.monthsToApproval);
        $slowestList.innerHTML = '';
        sortedDesc.slice(0, 5).forEach(d => {
            const el = document.createElement('div');
            el.className = 'record-item slowest';
            el.innerHTML = `<span><span class="rec-name">${d.drugName}</span><span class="rec-year"> (${d.approvalYear})</span></span><span class="rec-months">${d.monthsToApproval} mo</span>`;
            $slowestList.appendChild(el);
        });

        // Category breakdown
        const catCounts = {};
        data.forEach(d => {
            catCounts[d.category] = (catCounts[d.category] || 0) + 1;
        });
        const catSorted = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
        $categoryBreakdown.innerHTML = '';
        catSorted.forEach(([cat, count]) => {
            const color = CATEGORY_COLORS[cat] || '#64748b';
            const el = document.createElement('div');
            el.className = 'cat-break-row';
            el.innerHTML = `<span class="cat-break-dot" style="background:${color}"></span><span class="cat-break-name">${cat}</span><span class="cat-break-count">${count}</span>`;
            $categoryBreakdown.appendChild(el);
        });
    }

    // ---- Build category filter chips ----
    function buildCategoryFilters() {
        $categoryFilters.innerHTML = '';
        allCategories.forEach(cat => {
            const color = CATEGORY_COLORS[cat] || '#64748b';
            const btn = document.createElement('button');
            btn.className = 'cat-chip' + (filters.categories.size === 0 ? ' active' : (filters.categories.has(cat) ? ' active' : ''));
            btn.innerHTML = `<span class="cat-dot" style="background:${color}"></span>${cat}`;
            btn.addEventListener('click', () => {
                if (filters.categories.has(cat)) {
                    filters.categories.delete(cat);
                } else {
                    filters.categories.add(cat);
                }
                // If none selected, show all
                updateCategoryChipStates();
                refresh();
            });
            $categoryFilters.appendChild(btn);
        });
    }

    function updateCategoryChipStates() {
        const chips = $categoryFilters.querySelectorAll('.cat-chip');
        chips.forEach((chip, i) => {
            const cat = allCategories[i];
            if (filters.categories.size === 0) {
                chip.classList.add('active');
            } else {
                chip.classList.toggle('active', filters.categories.has(cat));
            }
        });

        // Update legend too
        const legendItems = $legendBar.querySelectorAll('.legend-item');
        legendItems.forEach(item => {
            const cat = item.dataset.cat;
            if (filters.categories.size === 0) {
                item.classList.remove('dimmed');
            } else {
                item.classList.toggle('dimmed', !filters.categories.has(cat));
            }
        });
    }

    // ---- Build legend ----
    function buildLegend() {
        $legendBar.innerHTML = '';
        allCategories.forEach(cat => {
            const color = CATEGORY_COLORS[cat] || '#64748b';
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.dataset.cat = cat;
            item.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${cat}`;
            item.addEventListener('click', () => {
                if (filters.categories.has(cat)) {
                    filters.categories.delete(cat);
                } else {
                    filters.categories.add(cat);
                }
                updateCategoryChipStates();
                refresh();
            });
            $legendBar.appendChild(item);
        });
    }

    // ---- Refresh everything ----
    function refresh() {
        const data = getFilteredData();
        updateStats(data);
        if (currentView === 'scatter') {
            renderScatter(data);
        } else {
            renderHistogram(data);
        }
    }

    // ---- Wire up controls ----
    function setupControls() {
        // View toggle
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = btn.dataset.view;
                refresh();
            });
        });

        // Decade filters
        document.querySelectorAll('.decade-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.decade-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filters.decade = btn.dataset.decade;
                refresh();
            });
        });

        // Review filters
        document.querySelectorAll('.review-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.review-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filters.review = btn.dataset.review;
                refresh();
            });
        });

        // NME toggle
        $nmeToggle.addEventListener('change', () => {
            filters.nmeOnly = $nmeToggle.checked;
            refresh();
        });

        // Search
        let searchTimeout;
        $searchBox.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                filters.search = $searchBox.value.trim();
                refresh();
            }, 250);
        });
    }

    // ---- Window resize ----
    function handleResize() {
        Plotly.Plots.resize($plotArea);
    }

    // ---- Init ----
    async function init() {
        try {
            const resp = await fetch('./fda_approval_data.json');
            allData = await resp.json();

            // Collect categories
            const catSet = new Set();
            allData.forEach(d => catSet.add(d.category));
            allCategories = [...catSet].sort();

            buildCategoryFilters();
            buildLegend();
            setupControls();

            // Initial render
            refresh();

            // Hide loading
            $loadingOverlay.classList.add('hidden');

            window.addEventListener('resize', handleResize);
        } catch (err) {
            console.error('Failed to load data:', err);
            $loadingOverlay.querySelector('.loading-text').textContent = 'Error loading data. Please refresh.';
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
