(function () {
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

    resultsDiv.innerHTML = summaryCards + tableHtml;

    const tableCsvBtn = document.getElementById("tableCsvBtn");
    if (tableCsvBtn) tableCsvBtn.addEventListener("click", downloadCSV);

    updateCharts(lastRows, assets);
  }

  function updateCharts(rows, assetsMeta) {
    const mainCanvas = document.getElementById("projectionChart");
    if (!rows || rows.length === 0 || !mainCanvas) return;

    const isNarrowScreen = window.innerWidth <= 600;

    const labels = rows.map(r => "Year " + r.year);
    const totalBalances = rows.map(r => r.totalBalance);

    let cumulative = 0;
    const cumulativeNetIncome = rows.map(r => (cumulative += r.yearPayoutNet));

    const lineDatasets = [
      {
        label: "Total balance",
        data: totalBalances,
        tension: 0.25,
        borderWidth: 2,
        borderColor: "#ef5122",
        fill: false,
        pointRadius: isNarrowScreen ? 0 : 3,
        pointHoverRadius: isNarrowScreen ? 0 : 5
      },
      {
        label: "Cumulative net income (after tax)",
        data: cumulativeNetIncome,
        tension: 0.25,
        borderWidth: 1.5,
        borderColor: "#ffe08c",
        borderDash: [6,4],
        fill: false,
        pointRadius: isNarrowScreen ? 0 : 3,
        pointHoverRadius: isNarrowScreen ? 0 : 5
      }
    ];

    assetsMeta.forEach((asset, idx) => {
      const series = rows.map(r => r.balancesByAsset[idx] || 0);
      lineDatasets.push({
        label: asset.name,
        data: series,
        tension: 0.25,
        borderWidth: 1.2,
        fill: false,
        pointRadius: isNarrowScreen ? 0 : 3,
        pointHoverRadius: isNarrowScreen ? 0 : 5
      });
    });

    const ctx = mainCanvas.getContext("2d");

    if (projectionChart) projectionChart.destroy();

    projectionChart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: lineDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false }
      }
    });
  }

  function downloadCSV() {}

  function downloadPNGFromChart(chart, filename) {}

  document.addEventListener("DOMContentLoaded", function () {
    const assetCountSelect = document.getElementById("assetCount");
    const calcBtn          = document.getElementById("calcBtn");

    if (assetCountSelect) {
      buildAssetRows(parseInt(assetCountSelect.value || "2", 10));
      assetCountSelect.addEventListener("change", function () {
        buildAssetRows(parseInt(this.value || "1", 10));
      });
    }

    if (calcBtn) calcBtn.addEventListener("click", calculateProjection);
  });

})();
