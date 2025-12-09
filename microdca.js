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
        hidden: datasetHidden[i] || false
      };
    });

    projectionChart.data.labels = windowLabels;
    projectionChart.data.datasets = windowDatasets;
    projectionChart.update();

    updateYearLabel();
    updateNavigatorHandles();
  }

  function initYearRangeControls(totalYears) {
    const container = document.getElementById("yearRangeControls");
    if (!container) return;
    container.innerHTML = "";

    if (totalYears <= 1) return;

    container.innerHTML =
      '<div class="year-range-header">'
      + '  <span class="range-label">View years</span>'
      + '  <span id="yearRangeLabel" class="range-display">Year 1 – Year ' + totalYears + '</span>'
      + '</div>';

    yearRangeLabelSpan = document.getElementById("yearRangeLabel");
    updateYearLabel();
  }

  function initNavigatorControls(totalYears) {
    navWrapper     = document.getElementById("navigatorWrapper");
    navHandleStart = document.getElementById("navHandleStart");
    navHandleEnd   = document.getElementById("navHandleEnd");
    navRangeShade  = document.getElementById("navRangeShade");

    if (!navWrapper || !navHandleStart || !navHandleEnd || !navRangeShade) return;

    if (totalYears <= 1) {
      navWrapper.style.display = "none";
      return;
    }
    navWrapper.style.display = "block";

    if (!navigatorInitialized) {
      const startDrag = function (type) {
        return function (e) {
          draggingHandle = type;
          e.preventDefault();
        };
      };
      const moveDrag = function (e) {
        if (!draggingHandle) return;
        handleNavigatorDragEvent(e);
      };
      const endDrag = function () { draggingHandle = null; };

      ["mousedown", "touchstart"].forEach(function (evt) {
        navHandleStart.addEventListener(evt, startDrag("start"));
        navHandleEnd.addEventListener(evt, startDrag("end"));
      });
      ["mousemove", "touchmove"].forEach(function (evt) {
        document.addEventListener(evt, moveDrag);
      });
      ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach(function (evt) {
        document.addEventListener(evt, endDrag);
      });

      navigatorInitialized = true;
    }

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
        fill: false
      },
      {
        label: "Cumulative net income (after tax)",
        data: cumulativeNetIncome,
        tension: 0.25,
        borderWidth: 1.5,
        borderColor: "#ffe08c",
        borderDash: [6,4],
        fill: false
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
        fill: false
      });
    });

    fullLabels   = labels;
    fullDatasets = lineDatasets;
    datasetHidden = new Array(fullDatasets.length).fill(false);
    currentStartIndex = 0;
    currentEndIndex   = labels.length - 1;


    const totalYears = labels.length;
    const isNarrowScreen = window.innerWidth <= 600;

    const commonScales = {
        x: {
            offset: false,
            ticks: {
            color: "#f5f5f5",
            font: { size: isNarrowScreen ? 9 : 11 },

            autoSkip: true,
            maxTicksLimit: isNarrowScreen ? 6 : 10,
            padding: 8,

            callback(value) {
                const label = this.getLabelForValue(value);
                return label.replace("Year ", "");
            }
            },
            grid: {
            color: "rgba(255,255,255,0.08)"
            }
        },

        y: {
            ticks: {
            color: "#f5f5f5",
            font: { size: isNarrowScreen ? 9 : 10 },
            maxTicksLimit: 6,
            callback(value) {
                return "$" + value.toLocaleString();
            }
            },
            grid: {
            color: "rgba(255,255,255,0.08)"
            }
        }
        };


    if (mainCanvas) {
      const ctx = mainCanvas.getContext("2d");
      const options = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        elements: { /* your existing point config here */ },
        plugins: { /* your existing legend + zoom config here */ },
        layout: {
            padding: {
                top: 10,
                left: 8,
                right: 8,
                bottom: 90
            }
        },
        scales: commonScales
        };


      if (!projectionChart) {
        projectionChart = new Chart(ctx, {
          type: "line",
          data: { labels: [], datasets: [] },
          options: options
        });
      } else {
        projectionChart.options = options;
      }
    }

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
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        },
        scales: {
          x: { display: false },
          y: { display: false }
        }
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

    if (togglesContainer) {
      togglesContainer.innerHTML = "";

      if (fullDatasets.length > 2) {
        fullDatasets.forEach(function (ds, idx) {
          if (idx < 2) return;
          const label = ds.label || ("Asset " + (idx - 1));
          const wrap  = document.createElement("label");
          wrap.className = "asset-toggle";

          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = !datasetHidden[idx];
          input.dataset.index = String(idx);
          input.addEventListener("change", function () {
            const i = parseInt(this.dataset.index, 10);
            datasetHidden[i] = !this.checked;
            applyYearWindow();
          });

          const span = document.createElement("span");
          span.textContent = label;

          wrap.appendChild(input);
          wrap.appendChild(span);
          togglesContainer.appendChild(wrap);
        });

        const btnWrap = document.createElement("div");
        btnWrap.className = "asset-toggle-buttons";

        const hideAll = document.createElement("button");
        hideAll.type = "button";
        hideAll.textContent = "Hide all assets";
        hideAll.addEventListener("click", function () {
          for (let i = 2; i < datasetHidden.length; i++) datasetHidden[i] = true;
          togglesContainer.querySelectorAll("input[type=checkbox]").forEach(function (c) { c.checked = false; });
          applyYearWindow();
        });

        const showAll = document.createElement("button");
        showAll.type = "button";
        showAll.textContent = "Show all assets";
        showAll.addEventListener("click", function () {
          for (let i = 2; i < datasetHidden.length; i++) datasetHidden[i] = false;
          togglesContainer.querySelectorAll("input[type=checkbox]").forEach(function (c) { c.checked = true; });
          applyYearWindow();
        });

        const resetZoomBtn = document.createElement("button");
        resetZoomBtn.type = "button";
        resetZoomBtn.textContent = "Reset zoom";
        resetZoomBtn.addEventListener("click", function () {
          if (projectionChart && projectionChart.resetZoom) {
            projectionChart.resetZoom();
          }
          currentStartIndex = 0;
          currentEndIndex = fullLabels.length ? fullLabels.length - 1 : 0;
          applyYearWindow();
        });

        btnWrap.appendChild(hideAll);
        btnWrap.appendChild(showAll);
        btnWrap.appendChild(resetZoomBtn);
        togglesContainer.appendChild(btnWrap);
      }
    }

    const finalRow = rows[rows.length - 1];

    if (allocCanvas && assetsMeta && assetsMeta.length && finalRow.balancesByAsset) {
      const ctx2        = allocCanvas.getContext("2d");
      const allocLabels = assetsMeta.map(function (a) { return a.name; });
      const allocData   = finalRow.balancesByAsset;
      const doughnutData = {
        labels: allocLabels,
        datasets: [{
          data: allocData,
          backgroundColor: assetColors.slice(0, allocLabels.length),
          borderWidth: 0
        }]
      };
      const doughnutOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: "#f5f5f5", usePointStyle: true }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const label = ctx.label || "";
                const value = ctx.parsed || 0;
                const arr   = ctx.dataset.data || [];
                const total = arr.reduce(function (a,b){return a+b;},0);
                const pct   = total ? ((value/total)*100).toFixed(1) : "0.0";
                return label + ": $" + formatMoney(value) + " (" + pct + "%)";
              }
            }
          }
        }
      };

      if (allocationChart) {
        allocationChart.data = doughnutData;
        allocationChart.options = doughnutOptions;
        allocationChart.update();
      } else {
        allocationChart = new Chart(ctx2, { type: "doughnut", data: doughnutData, options: doughnutOptions });
      }
    }

    if (incomeCanvas && lastSummary) {
      const ctx3 = incomeCanvas.getContext("2d");
      const s    = lastSummary;
      const incomeData = {
        labels: ["Reinvested distributions","Net income received","Taxes on income"],
        datasets: [{
          data: [s.totalReinvested, s.totalPaidOutNet, s.totalTaxPaid],
          backgroundColor: ["#4bc0c0","#ef5122","#ffcd56"],
          borderWidth: 0
        }]
      };
      const incomeOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: "#f5f5f5", usePointStyle: true }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const label = ctx.label || "";
                const value = ctx.parsed || 0;
                const arr   = ctx.dataset.data || [];
                const total = arr.reduce(function (a,b){return a+b;},0);
                const pct   = total ? ((value/total)*100).toFixed(1) : "0.0";
                return label + ": $" + formatMoney(value) + " (" + pct + "%)";
              }
            }
          }
        }
      };

      if (incomeChart) {
        incomeChart.data = incomeData;
        incomeChart.options = incomeOptions;
        incomeChart.update();
      } else {
        incomeChart = new Chart(ctx3, { type: "doughnut", data: incomeData, options: incomeOptions });
      }
    }
  }

  function downloadCSV() {
    if (!lastRows || lastRows.length === 0 || !lastSummary) {
      alert("Please run a calculation first.");
      return;
    }

    const finalRow = lastRows[lastRows.length - 1];
    const s = lastSummary;

    let totalDistributions = 0;
    let totalGrossPayout   = 0;
    let totalNetPayout     = 0;

    lastRows.forEach(function (row) {
      totalDistributions += row.yearDist;
      totalGrossPayout   += row.yearPayoutGross;
      totalNetPayout     += row.yearPayoutNet;
    });

    const totalTax        = totalGrossPayout - totalNetPayout;
    const totalReinvested = totalDistributions - totalGrossPayout;

    const lines = [];

    lines.push("Summary");
    lines.push("Metric,Value");
    lines.push("Final total balance,$" + finalRow.totalBalance.toFixed(2));
    lines.push("Total contributions,$" + finalRow.totalContrib.toFixed(2));
    lines.push("Total growth,$" + finalRow.growth.toFixed(2));

    if (lastAssetsMeta && lastAssetsMeta.length && finalRow.balancesByAsset) {
      lastAssetsMeta.forEach(function (asset, index) {
        const bal = finalRow.balancesByAsset[index] || 0;
        lines.push("Final balance - " + asset.name + ",$" + bal.toFixed(2));
      });
    }

    lines.push("");
    lines.push("Distributions over entire period (all assets),");
    lines.push("Total distributions generated,$" + totalDistributions.toFixed(2));
    lines.push("Total reinvested into assets,$" + totalReinvested.toFixed(2));
    lines.push("Total income paid out (gross),$" + totalGrossPayout.toFixed(2));
    lines.push("Total tax on income,$" + totalTax.toFixed(2));
    lines.push("Total income received (net after tax),$" + totalNetPayout.toFixed(2));

    lines.push("");
    lines.push("Income run-rate (last year),");
    lines.push("Gross (before tax),");
    lines.push("Annual gross,$"    + s.annualGrossIncome.toFixed(2));
    lines.push("Quarterly gross,$" + s.quarterlyGross.toFixed(2));
    lines.push("Monthly gross,$"   + s.monthlyGross.toFixed(2));
    lines.push("Weekly gross,$"    + s.weeklyGross.toFixed(2));

    lines.push("");
    lines.push("Net (after tax),");
    lines.push("Annual net,$"    + s.annualNetIncome.toFixed(2));
    lines.push("Quarterly net,$" + s.quarterlyNet.toFixed(2));
    lines.push("Monthly net,$"   + s.monthlyNet.toFixed(2));
    lines.push("Weekly net,$"    + s.weeklyNet.toFixed(2));

    lines.push("");
    lines.push("Year-by-year breakdown,");

    const header = [
      "Year",
      "Total contributions",
      "Total growth",
      "Total balance",
      "Distributions (year)",
      "Income paid out gross (year)",
      "Income paid out net (year)",
      "Cumulative net income (after tax)"
    ];

    if (lastAssetsMeta && lastAssetsMeta.length) {
      lastAssetsMeta.forEach(function (asset) {
        header.push(asset.name + " balance (year end)");
      });
    }
    lines.push(header.join(","));

    let cumulativeNet = 0;
    lastRows.forEach(function (row) {
      cumulativeNet += row.yearPayoutNet;
      const baseCols = [
        row.year,
        row.totalContrib.toFixed(2),
        row.growth.toFixed(2),
        row.totalBalance.toFixed(2),
        row.yearDist.toFixed(2),
        row.yearPayoutGross.toFixed(2),
        row.yearPayoutNet.toFixed(2),
        cumulativeNet.toFixed(2)
      ];
      const assetCols = [];
      if (row.balancesByAsset && row.balancesByAsset.length) {
        row.balancesByAsset.forEach(function (bal) {
          assetCols.push((bal || 0).toFixed(2));
        });
      }
      lines.push(baseCols.concat(assetCols).join(","));
    });

    const csvContent = lines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "microdca_projection_detailed.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function downloadPNGFromChart(chart, filename) {
    if (!chart) {
      alert("Please run a calculation first.");
      return;
    }
    const link = document.createElement("a");
    link.href = chart.toBase64Image();
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function downloadProjectionPNG() {
    downloadPNGFromChart(projectionChart, "microdca_projection_chart.png");
  }

  function downloadAllocationPNG() {
    downloadPNGFromChart(allocationChart, "microdca_allocation_chart.png");
  }

  function downloadIncomePNG() {
    downloadPNGFromChart(incomeChart, "microdca_income_chart.png");
  }

  document.addEventListener("DOMContentLoaded", function () {
    const assetCountSelect = document.getElementById("assetCount");
    const calcBtn          = document.getElementById("calcBtn");
    const csvAllBtn        = document.getElementById("csvAllBtn");
    const mainPngBtn       = document.getElementById("mainPngBtn");
    const allocPngBtn      = document.getElementById("allocPngBtn");
    const incomePngBtn     = document.getElementById("incomePngBtn");

    if (assetCountSelect) {
      buildAssetRows(parseInt(assetCountSelect.value || "2", 10));
      assetCountSelect.addEventListener("change", function () {
        const count = parseInt(this.value || "1", 10);
        buildAssetRows(count);
      });
    }

    if (calcBtn)   calcBtn.addEventListener("click", calculateProjection);
    if (csvAllBtn) csvAllBtn.addEventListener("click", downloadCSV);

    if (mainPngBtn)   mainPngBtn.addEventListener("click", downloadProjectionPNG);
    if (allocPngBtn)  allocPngBtn.addEventListener("click", downloadAllocationPNG);
    if (incomePngBtn) incomePngBtn.addEventListener("click", downloadIncomePNG);
  });
})();
