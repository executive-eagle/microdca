(function () {

  /* ✅ MOBILE DETECTOR */
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

  function buildAssetRows(count) {
    const container = document.getElementById("assetsContainer");
    if (!container) return;
    container.innerHTML = "";

    const equalAlloc = 100 / count;

    for (let i = 0; i < count; i++) {
      const index = i + 1;
      const row = document.createElement("div");
      row.className = "asset-row";
      row.setAttribute("data-index", String(i));

      row.innerHTML =
        '<div class="asset-row-inner">'
      + '  <div class="asset-card">'
      + '    <div class="asset-card-header">Asset ' + index + ' name</div>'
      + '    <input type="text" class="asset-name" placeholder="'
      + (index === 1 ? 'Bitcoin' : (index === 2 ? 'Income ETF' : 'Asset ' + index))
      + '" />'
      + '  </div>'
      + '  <div class="asset-field">'
      + '    <label>Allocation (%)</label>'
      + '    <input type="number" class="asset-alloc" min="0" max="100" step="0.1" value="'
      + equalAlloc.toFixed(1) + '" />'
      + '  </div>'
      + '  <div class="asset-field">'
      + '    <label>Annual growth (%)</label>'
      + '    <input type="number" class="asset-growth" step="0.1" value="'
      + (index === 1 ? 15 : 8) + '" />'
      + '  </div>'
      + '  <div class="asset-field">'
      + '    <label>Distribution yield (%)</label>'
      + '    <input type="number" class="asset-yield" step="0.1" value="'
      + (index === 2 ? 8 : 0) + '" />'
      + '  </div>'
      + '  <div class="asset-field">'
      + '    <label>Reinvest % of distributions</label>'
      + '    <input type="number" class="asset-reinvest" min="0" max="100" step="1" value="50" />'
      + '  </div>'
      + '</div>';

      container.appendChild(row);
    }

    const hint = document.createElement("p");
    hint.className = "assets-hint";
    hint.innerHTML =
      'Tip: Many users set Asset 1 = <strong>Bitcoin</strong> and Asset 2 = <strong>income ETF</strong>, but you can model up to 10 different assets.';
    container.appendChild(hint);
  }

  function calculateProjection() {
    const startBalance = parseFloat(document.getElementById("startBalance").value || 0);
    const contributionAmount = parseFloat(document.getElementById("contributionAmount").value || 0);
    const contributionFreq = document.getElementById("contributionFreq").value;
    const years = parseInt(document.getElementById("years").value || 0, 10);
    const compFreq = document.getElementById("compFreq").value;

    const correctionSizePct = parseFloat(document.getElementById("correctionSize").value || 0);
    const correctionFreqYears = parseInt(document.getElementById("correctionFreqYears").value || 0, 10);
    const hasCorrections = correctionSizePct > 0 && correctionFreqYears > 0;
    const correctionDropFrac = correctionSizePct / 100;

    const taxRatePct = parseFloat(document.getElementById("taxRate").value || 0);
    const taxFrac = Math.min(Math.max(isNaN(taxRatePct) ? 0 : taxRatePct / 100, 0), 1);

    if (years <= 0) {
      alert("Please enter a number of years greater than zero.");
      return;
    }

    const assetRows = document.querySelectorAll(".asset-row");
    if (!assetRows.length) {
      alert("Please add at least one asset.");
      return;
    }

    const assets = [];
    let allocSum = 0;

    assetRows.forEach(function (row, idx) {
      const name = (row.querySelector(".asset-name").value || "").trim() || ("Asset " + (idx + 1));
      const allocPct = parseFloat(row.querySelector(".asset-alloc").value || 0);
      const growthPct = parseFloat(row.querySelector(".asset-growth").value || 0);
      const yieldPct = parseFloat(row.querySelector(".asset-yield").value || 0);
      const reinvestPctInput = parseFloat(row.querySelector(".asset-reinvest").value || 0);

      allocSum += isNaN(allocPct) ? 0 : allocPct;

      assets.push({
        name: name,
        allocPct: isNaN(allocPct) ? 0 : allocPct,
        growthPct: isNaN(growthPct) ? 0 : growthPct,
        yieldPct: isNaN(yieldPct) ? 0 : yieldPct,
        reinvestFrac: Math.min(Math.max((isNaN(reinvestPctInput) ? 0 : reinvestPctInput) / 100, 0), 1),
        balance: 0
      });
    });

    if (allocSum <= 0) {
      alert("Please give at least one asset a positive allocation.");
      return;
    }

    assets.forEach(function (a) { a.allocFrac = a.allocPct / allocSum; });

    const compStepsMap = { daily: 365, monthly: 12, quarterly: 4, yearly: 1 };
    const stepsPerYear = compStepsMap[compFreq] || 12;
    const totalSteps = years * stepsPerYear;

    let annualContribution = 0;
    switch (contributionFreq) {
      case "daily365": annualContribution = contributionAmount * 365; break;
      case "daily251": annualContribution = contributionAmount * 251; break;
      case "weekly":   annualContribution = contributionAmount * 52;  break;
      case "monthly":  annualContribution = contributionAmount * 12;  break;
      case "yearly":   annualContribution = contributionAmount;       break;
      default:         annualContribution = contributionAmount * 12;
    }
    const stepContribution = annualContribution / stepsPerYear;

    let totalContrib = startBalance;
    assets.forEach(function (a) { a.balance = startBalance * a.allocFrac; });

    assets.forEach(function (a) {
      a.growthPerStep = a.growthPct / 100 / stepsPerYear;
      a.yieldPerStep  = a.yieldPct  / 100 / stepsPerYear;
    });

    let totalDistributions = 0;
    let totalReinvested   = 0;
    let totalPaidOutGross = 0;
    let totalPaidOutNet   = 0;
    let totalTaxPaid      = 0;

    let yearDistTotal        = 0;
    let yearPayoutGrossTotal = 0;
    let yearPayoutNetTotal   = 0;

    lastRows = [];

    for (let step = 1; step <= totalSteps; step++) {
      assets.forEach(function (a) {
        a.balance *= 1 + a.growthPerStep;

        const contribThisStep = stepContribution * a.allocFrac;
        a.balance += contribThisStep;
        totalContrib += contribThisStep;

        const distThisStep = a.balance * a.yieldPerStep;
        if (distThisStep > 0) {
          const reinvestAmount    = distThisStep * a.reinvestFrac;
          const payoutAmountGross = distThisStep - reinvestAmount;

          const taxThisStep       = payoutAmountGross * taxFrac;
          const payoutAmountNet   = payoutAmountGross - taxThisStep;

          a.balance += reinvestAmount;

          totalDistributions += distThisStep;
          totalReinvested   += reinvestAmount;
          totalPaidOutGross += payoutAmountGross;
          totalPaidOutNet   += payoutAmountNet;
          totalTaxPaid      += taxThisStep;

          yearDistTotal        += distThisStep;
          yearPayoutGrossTotal += payoutAmountGross;
          yearPayoutNetTotal   += payoutAmountNet;
        }
      });

      if (step % stepsPerYear === 0) {
        const yearNumber = step / stepsPerYear;

        if (hasCorrections && yearNumber % correctionFreqYears === 0) {
          assets.forEach(function (a) { a.balance *= 1 - correctionDropFrac; });
        }

        const totalBalance    = assets.reduce(function (sum, a) { return sum + a.balance; }, 0);
        const growth          = totalBalance - totalContrib;
        const balancesByAsset = assets.map(function (a) { return a.balance; });

        lastRows.push({
          year: yearNumber,
          totalContrib: totalContrib,
          growth: growth,
          totalBalance: totalBalance,
          yearDist: yearDistTotal,
          yearPayoutGross: yearPayoutGrossTotal,
          yearPayoutNet: yearPayoutNetTotal,
          balancesByAsset: balancesByAsset
        });

        yearDistTotal        = 0;
        yearPayoutGrossTotal = 0;
        yearPayoutNetTotal   = 0;
      }
    }

    lastAssetsMeta = assets.map(function (a) { return { name: a.name }; });
    const finalRow = lastRows[lastRows.length - 1];
    const resultsDiv = document.getElementById("results");

    const finalBalance      = finalRow.totalBalance;
    const annualGrossIncome = finalRow.yearPayoutGross;
    const annualNetIncome   = finalRow.yearPayoutNet;

    const weeklyGross    = annualGrossIncome / 52;
    const monthlyGross   = annualGrossIncome / 12;
    const quarterlyGross = annualGrossIncome / 4;

    const weeklyNet    = annualNetIncome / 52;
    const monthlyNet   = annualNetIncome / 12;
    const quarterlyNet = annualNetIncome / 4;

    lastSummary = {
      years: years,
      finalBalance: finalBalance,
      totalContrib: totalContrib,
      totalGrowth: finalRow.growth,
      totalDistributions: totalDistributions,
      totalReinvested: totalReinvested,
      totalPaidOutGross: totalPaidOutGross,
      totalTaxPaid: totalTaxPaid,
      totalPaidOutNet: totalPaidOutNet,
      annualGrossIncome: annualGrossIncome,
      quarterlyGross: quarterlyGross,
      monthlyGross: monthlyGross,
      weeklyGross: weeklyGross,
      annualNetIncome: annualNetIncome,
      quarterlyNet: quarterlyNet,
      monthlyNet: monthlyNet,
      weeklyNet: weeklyNet
    };

    let assetListHtml = '<ul class="asset-list">';
    assets.forEach(function (a) {
      assetListHtml += '<li>' + a.name + ': <strong>$' + formatMoney(a.balance) + '</strong></li>';
    });
    assetListHtml += '</ul>';

    const s = lastSummary;

    const summaryCards =
      '<div class="summary-grid">'
      + '  <div class="summary-card">'
      + '    <div class="summary-label">Final total balance</div>'
      + '    <div class="summary-value primary">$' + formatMoney(s.finalBalance) + '</div>'
      + '    <div class="summary-sub">After ' + years + ' year' + (years > 1 ? 's' : '') + '</div>'
      + '  </div>'
      + '  <div class="summary-card">'
      + '    <div class="summary-label">Total contributions</div>'
      + '    <div class="summary-value">$' + formatMoney(s.totalContrib) + '</div>'
      + '    <div class="summary-sub">Principal you added</div>'
      + '  </div>'
      + '  <div class="summary-card">'
      + '    <div class="summary-label">Total growth</div>'
      + '    <div class="summary-value ' + (s.totalGrowth >= 0 ? 'positive' : 'negative') + '">'
      + '      $' + formatMoney(s.totalGrowth)
      + '    </div>'
      + '    <div class="summary-sub">Market gains / losses</div>'
      + '  </div>'
      + '  <div class="summary-card">'
      + '    <div class="summary-label">Total net income received</div>'
      + '    <div class="summary-value">$' + formatMoney(s.totalPaidOutNet) + '</div>'
      + '    <div class="summary-sub">After tax, over full period</div>'
      + '  </div>'
      + '</div>';

    let tableHtml =
      '<h4 class="results-heading">Year-by-year breakdown</h4>'
      + '<div class="table-wrapper">'
      + '<table class="projection-table">'
      + '<thead>'
      + '<tr>'
      + '<th>Year</th>'
      + '<th>Total contributions</th>'
      + '<th>Total growth</th>'
      + '<th>Total balance</th>'
      + '<th>Distributions (year)</th>'
      + '<th>Income paid out, gross (year)</th>'
      + '<th>Income paid out, net (year)</th>'
      + '</tr>'
      + '</thead>'
      + '<tbody>';

    lastRows.forEach(function (row) {
      tableHtml +=
        '<tr>'
      + '<td>' + row.year + '</td>'
      + '<td>$' + formatMoney(row.totalContrib) + '</td>'
      + '<td>$' + formatMoney(row.growth) + '</td>'
      + '<td>$' + formatMoney(row.totalBalance) + '</td>'
      + '<td>$' + formatMoney(row.yearDist) + '</td>'
      + '<td>$' + formatMoney(row.yearPayoutGross) + '</td>'
      + '<td>$' + formatMoney(row.yearPayoutNet) + '</td>'
      + '</tr>';
    });

    tableHtml +=
      '</tbody>'
      + '</table>'
      + '</div>'
      + '<div class="table-download-row">'
      + '  <button id="tableCsvBtn" type="button" class="csv-button small">Download table CSV</button>'
      + '</div>';

    const summaryHtml =
      summaryCards
      + '<div class="results-section">'
      + '  <h4>Final balances by asset</h4>'
      +     assetListHtml
      + '</div>'
      + '<div class="results-section">'
      + '  <h4>Distributions over entire period (all assets)</h4>'
      + '  <p>Total distributions generated: <strong style="color:#ef5122">$' + formatMoney(s.totalDistributions) + '</strong></p>'
      + '  <p>Total reinvested into assets: <strong style="color:#ef5122">$' + formatMoney(s.totalReinvested) + '</strong></p>'
      + '  <p>Total income paid out (gross): <strong style="color:#ef5122">$' + formatMoney(s.totalPaidOutGross) + '</strong></p>'
      + '  <p>Total tax on income: <strong style="color:#ef5122">$' + formatMoney(s.totalTaxPaid) + '</strong></p>'
      + '  <p>Total income received (net after tax): <strong style="color:#ef5122">$' + formatMoney(s.totalPaidOutNet) + '</strong></p>'
      + '</div>'
      + '<div class="results-section">'
      + '  <h4>Income run-rate (last year)</h4>'
      + '  <div class="income-grid">'
      + '    <div>'
      + '      <p class="income-heading">Gross (before tax)</p>'
      + '      <p>Annual: <strong style="color:#ef5122">$' + formatMoney(s.annualGrossIncome) + '</strong></p>'
      + '      <p>Quarterly: <strong style="color:#ef5122">$' + formatMoney(s.quarterlyGross) + '</strong></p>'
      + '      <p>Monthly: <strong style="color:#ef5122">$' + formatMoney(s.monthlyGross) + '</strong></p>'
      + '      <p>Weekly: <strong style="color:#ef5122">$' + formatMoney(s.weeklyGross) + '</strong></p>'
      + '    </div>'
      + '    <div>'
      + '      <p class="income-heading">Net (after tax)</p>'
      + '      <p>Annual: <strong style="color:#ef5122">$' + formatMoney(s.annualNetIncome) + '</strong></p>'
      + '      <p>Quarterly: <strong style="color:#ef5122">$' + formatMoney(s.quarterlyNet) + '</strong></p>'
      + '      <p>Monthly: <strong style="color:#ef5122">$' + formatMoney(s.monthlyNet) + '</strong></p>'
      + '      <p>Weekly: <strong style="color:#ef5122">$' + formatMoney(s.weeklyNet) + '</strong></p>'
      + '    </div>'
      + '  </div>'
      + '</div>';

    resultsDiv.innerHTML = summaryHtml + tableHtml;

    const tableCsvBtn = document.getElementById("tableCsvBtn");
    if (tableCsvBtn) {
      tableCsvBtn.addEventListener("click", downloadCSV);
    }

    updateCharts(lastRows, assets);
  }

  function updateYearLabel() {
    if (!yearRangeLabelSpan || !fullLabels.length) return;
    const s = currentStartIndex + 1;
    const e = currentEndIndex + 1;
    yearRangeLabelSpan.textContent = (s === e) ? ("Year " + s) : ("Year " + s + " – Year " + e);
  }

  function updateNavigatorHandles() {
    if (!navWrapper || !navHandleStart || !navHandleEnd || !navRangeShade || !fullLabels.length) return;
    const maxIndex = fullLabels.length - 1 || 1;
    const startPct = (currentStartIndex / maxIndex) * 100;
    const endPct   = (currentEndIndex / maxIndex) * 100;

    navHandleStart.style.left = startPct + "%";
    navHandleEnd.style.left   = endPct + "%";
    navRangeShade.style.left  = startPct + "%";
    navRangeShade.style.width = Math.max(endPct - startPct, 0) + "%";
  }

  function handleNavigatorDragEvent(e) {
    if (!draggingHandle || !navWrapper || !fullLabels.length) return;
    const rect = navWrapper.getBoundingClientRect();
    const clientX = (e.touches && e.touches.length) ? e.touches[0].clientX : e.clientX;
    let pct = (clientX - rect.left) / rect.width;
    if (pct < 0) pct = 0;
    if (pct > 1) pct = 1;

    const maxIndex = fullLabels.length - 1;
    const idx = Math.round(pct * maxIndex);

    if (draggingHandle === "start") {
      currentStartIndex = Math.min(idx, currentEndIndex);
    } else if (draggingHandle === "end") {
      currentEndIndex = Math.max(idx, currentStartIndex);
    }

    applyYearWindow();
  }

  function applyYearWindow() {
    if (!projectionChart || !fullLabels.length || !fullDatasets.length) return;

    const start = Math.max(0, Math.min(currentStartIndex, fullLabels.length - 1));
    const end   = Math.max(start, Math.min(currentEndIndex, fullLabels.length - 1));

    currentStartIndex = start;
    currentEndIndex   = end;

    const windowLabels = fullLabels.slice(start, end + 1);
    const windowDatasets = fullDatasets.map(function (ds, i) {
      return {
        label: ds.label,
        data: ds.data.slice(start, end + 1),
        tension: ds.tension,
        borderWidth: ds.borderWidth,
        borderColor: ds.borderColor,
        borderDash: ds.borderDash,
        fill: ds.fill,
        hidden: datasetHidden[i] || false,

        /* ✅ PRESERVE MOBILE DOT OVERRIDE */
        pointRadius: ds.pointRadius,
        pointHoverRadius: ds.pointHoverRadius
      };
    });

    projectionChart.data.labels = windowLabels;
    projectionChart.data.datasets = windowDatasets;
    projectionChart.update();

    updateYearLabel();
    updateNavigatorHandles();
  }

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

    applyYearWindow();
  }

  /* ✅ CSV + PNG FUNCTIONS UNCHANGED ✅ */
  /* ✅ DOM READY BINDINGS UNCHANGED ✅ */

})();
