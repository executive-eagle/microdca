(function () {

  /* ✅ MOBILE DETECTOR (GLOBAL) */
  const isMobile = window.innerWidth <= 600;

  function formatMoney(x) {
    return x.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  let lastRows = [];
  let projectionChart = null;
  let allocationChart = null;
  let incomeChart = null;
  let navigatorChart = null;
  let lastAssetsMeta = [];
  let lastSummary = null;

  let fullLabels = [];
  let fullDatasets = [];
  let datasetHidden = [];
  let currentStartIndex = 0;
  let currentEndIndex   = 0;

  let yearRangeLabelSpan = null;
  let navWrapper = null;
  let navHandleStart = null;
  let navHandleEnd = null;
  let navRangeShade = null;
  let draggingHandle = null;
  let navigatorInitialized = false;

  if (window["chartjs-plugin-zoom"]) {
    Chart.register(window["chartjs-plugin-zoom"]);
  }

  /* ---------------- REMAINDER UNCHANGED ABOVE ---------------- */

  function updateCharts(rows, assetsMeta) {
    const mainCanvas      = document.getElementById("projectionChart");
    const allocCanvas     = document.getElementById("allocationChart");
    const incomeCanvas    = document.getElementById("incomeChart");
    const navigatorCanvas = document.getElementById("navigatorChart");
    const togglesContainer = document.getElementById("assetToggles");
    if (!rows || rows.length === 0) return;

    const labels        = rows.map(function (r) { return "Year " + r.year; });
    const totalBalances = rows.map(function (r) { return r.totalBalance; });

    let cumulative = 0;
    const cumulativeNetIncome = rows.map(function (r) {
      cumulative += r.yearPayoutNet;
      return cumulative;
    });

    const assetColors = [
      "#36a2eb", "#4bc0c0", "#9966ff", "#ff9f40", "#ff6384",
      "#a3e048", "#f7d038", "#eb7532", "#e6261f", "#3b7dd8"
    ];

    /* ✅ ✅ ✅ MOBILE NO-DOTS EMBEDDED HERE */
    const lineDatasets = [
      {
        label: "Total balance",
        data: totalBalances,
        tension: 0.25,
        borderWidth: 2,
        borderColor: "#ef5122",
        fill: false,
        pointRadius: isMobile ? 0 : 4,
        pointHoverRadius: isMobile ? 0 : 6
      },
      {
        label: "Cumulative net income (after tax)",
        data: cumulativeNetIncome,
        tension: 0.25,
        borderWidth: 1.5,
        borderColor: "#ffe08c",
        borderDash: [6,4],
        fill: false,
        pointRadius: isMobile ? 0 : 4,
        pointHoverRadius: isMobile ? 0 : 6
      }
    ];

    assetsMeta.forEach(function (asset, index) {
      const series = rows.map(function (r) {
        return (r.balancesByAsset && r.balancesByAsset[index] != null) ? r.balancesByAsset[index] : 0;
      });
      lineDatasets.push({
        label: asset.name,
        data: series,
        tension: 0.25,
        borderWidth: 1.5,
        borderColor: assetColors[index % assetColors.length],
        fill: false,
        pointRadius: isMobile ? 0 : 3,
        pointHoverRadius: isMobile ? 0 : 5
      });
    });

    fullLabels   = labels;
    fullDatasets = lineDatasets;
    datasetHidden = new Array(fullDatasets.length).fill(false);
    currentStartIndex = 0;
    currentEndIndex   = labels.length - 1;

    /* ---------------- APPLY WINDOW FIX (CRITICAL) ---------------- */

    function applyYearWindow() {
      const start = Math.max(0, Math.min(currentStartIndex, fullLabels.length - 1));
      const end   = Math.max(start, Math.min(currentEndIndex, fullLabels.length - 1));

      projectionChart.data.labels = fullLabels.slice(start, end + 1);
      projectionChart.data.datasets = fullDatasets.map(function (ds, i) {
        return {
          ...ds,
          data: ds.data.slice(start, end + 1),
          hidden: datasetHidden[i],
          pointRadius: ds.pointRadius,
          pointHoverRadius: ds.pointHoverRadius
        };
      });

      projectionChart.update();
      updateYearLabel();
      updateNavigatorHandles();
    }

    /* ---------------- MAIN CHART ---------------- */

    if (mainCanvas) {
      const ctx = mainCanvas.getContext("2d");

      const options = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 10, left: 8, right: 8, bottom: 90 }},
        scales: {
          x: { ticks: { color: "#f5f5f5" }, grid: { color: "rgba(255,255,255,0.08)" }},
          y: { ticks: { color: "#f5f5f5" }, grid: { color: "rgba(255,255,255,0.08)" }}
        }
      };

      if (!projectionChart) {
        projectionChart = new Chart(ctx, {
          type: "line",
          data: { labels: labels, datasets: lineDatasets },
          options: options
        });
      } else {
        projectionChart.data.labels = labels;
        projectionChart.data.datasets = lineDatasets;
        projectionChart.options = options;
        projectionChart.update();
      }
    }

    /* ---------------- NAVIGATOR ---------------- */

    if (navigatorCanvas) {
      const ctxNav = navigatorCanvas.getContext("2d");
      const navData = {
        labels: labels,
        datasets: [{
          label: "Navigator",
          data: totalBalances,
          tension: 0.25,
          borderWidth: 1,
          borderColor: "#ef5122",
          fill: true,
          backgroundColor: "rgba(239,81,34,0.18)",
          pointRadius: 0
        }]
      };

      const navOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false }},
        scales: { x: { display: false }, y: { display: false }}
      };

      if (navigatorChart) {
        navigatorChart.data = navData;
        navigatorChart.options = navOptions;
        navigatorChart.update();
      } else {
        navigatorChart = new Chart(ctxNav, { type: "line", data: navData, options: navOptions });
      }
    }

    initYearRangeControls(labels.length);
    initNavigatorControls(labels.length);
    applyYearWindow();
  }

  /* ✅ EVERYTHING ELSE BELOW REMAINS UNCHANGED ✅ */

})();
