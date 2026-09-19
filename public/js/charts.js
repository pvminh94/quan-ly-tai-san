/* ==========================================================================
   charts.js — Biểu đồ SVG thuần (không thư viện ngoài)
   ========================================================================== */
(function () {
  'use strict';
  const U = App.U;
  const Charts = {};
  window.Charts = Charts;

  const PALETTE = App.PALETTE;

  function fmt(v, fmtType) {
    if (fmtType === 'money') return U.moneyShort(v);
    if (fmtType === 'percent') return U.num(v, 1) + '%';
    return U.num(v, 0);
  }

  /* ------------------------------ Cột ngang ------------------------------ */
  Charts.hBar = function (data, opts) {
    const o = Object.assign({ valueKey: 'value', labelKey: 'label', height: 26, format: 'money', showValues: true, color: null }, opts || {});
    if (!data || !data.length) return '<div class="empty tiny">Không có dữ liệu</div>';
    const max = Math.max.apply(null, data.map((d) => Number(d[o.valueKey]) || 0)) || 1;
    return `<div class="chart">${data
      .map((d, i) => {
        const val = Number(d[o.valueKey]) || 0;
        const pct = Math.max(2, Math.round((val / max) * 100));
        const color = o.color || (d.color || PALETTE[i % PALETTE.length]);
        return `<div style="margin-bottom:9px">
          <div class="row between" style="font-size:12px">
            <span style="max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${U.attr(d[o.labelKey])}">${U.esc(d[o.labelKey] || '—')}</span>
            <b class="mono">${fmt(val, o.format)}</b>
          </div>
          <div class="progress" style="margin-top:3px"><span style="width:${pct}%;background:${color}"></span></div>
        </div>`;
      })
      .join('')}</div>`;
  };

  /* ------------------------------ Cột dọc ------------------------------ */
  Charts.vBar = function (data, opts) {
    const o = Object.assign({ valueKey: 'value', labelKey: 'label', height: 200, format: 'money', color: '#2563eb', stacked: false }, opts || {});
    if (!data || !data.length) return '<div class="empty tiny">Không có dữ liệu</div>';
    const W = 640, H = o.height, padL = 52, padB = 34, padT = 12, padR = 8;
    const max = Math.max.apply(null, data.map((d) => Number(d[o.valueKey]) || 0)) || 1;
    const bw = (W - padL - padR) / data.length;
    const gridLines = 4;
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">`;
    for (let i = 0; i <= gridLines; i++) {
      const y = padT + ((H - padT - padB) * i) / gridLines;
      const val = max - (max * i) / gridLines;
      svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#94a3b8" font-family="Inter,sans-serif">${fmt(val, o.format)}</text>`;
    }
    data.forEach((d, i) => {
      const val = Number(d[o.valueKey]) || 0;
      const h = ((H - padT - padB) * val) / max;
      const x = padL + i * bw + bw * 0.18;
      const w = bw * 0.64;
      const y = H - padB - h;
      svg += `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(1, h)}" rx="3" fill="${d.color || o.color}"><title>${U.esc(d[o.labelKey])}: ${fmt(val, o.format)}</title></rect>`;
      svg += `<text x="${x + w / 2}" y="${H - padB + 12}" text-anchor="middle" font-size="9.5" fill="#64748b" font-family="Inter,sans-serif">${U.esc(String(d[o.labelKey] || '').slice(0, 10))}</text>`;
    });
    svg += `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#cbd5e1"/>`;
    svg += '</svg>';
    return svg;
  };

  /* ------------------------------ Đường ------------------------------ */
  Charts.line = function (series, opts) {
    const o = Object.assign({ height: 220, format: 'money', xKey: 'label', valueKey: 'value', color: '#2563eb', area: true }, opts || {});
    if (!series || !series.length) return '<div class="empty tiny">Không có dữ liệu</div>';
    const W = 660, H = o.height, padL = 56, padB = 30, padT = 14, padR = 12;
    const vals = series.map((d) => Number(d[o.valueKey]) || 0);
    const max = Math.max.apply(null, vals) || 1;
    const stepX = (W - padL - padR) / Math.max(1, series.length - 1);
    const scaleY = (v) => padT + (H - padT - padB) * (1 - v / max);
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" style="height:${H}px">`;
    for (let i = 0; i <= 4; i++) {
      const y = padT + ((H - padT - padB) * i) / 4;
      svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0"/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#94a3b8" font-family="Inter,sans-serif">${fmt(max - (max * i) / 4, o.format)}</text>`;
    }
    const pts = series.map((d, i) => [padL + i * stepX, scaleY(Number(d[o.valueKey]) || 0)]);
    const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    if (o.area) svg += `<path d="${path} L ${pts[pts.length - 1][0]} ${H - padB} L ${pts[0][0]} ${H - padB} Z" fill="${U.hexToRgba(o.color, .14)}"/>`;
    svg += `<path d="${path}" fill="none" stroke="${o.color}" stroke-width="2.2" stroke-linejoin="round"/>`;
    pts.forEach((p, i) => {
      svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3.4" fill="#fff" stroke="${o.color}" stroke-width="2"><title>${U.esc(series[i][o.xKey])}: ${fmt(series[i][o.valueKey], o.format)}</title></circle>`;
      if (series.length <= 14 || i % 2 === 0) svg += `<text x="${p[0]}" y="${H - padB + 13}" text-anchor="middle" font-size="9.5" fill="#64748b" font-family="Inter,sans-serif">${U.esc(series[i][o.xKey])}</text>`;
    });
    svg += '</svg>';
    return svg;
  };

  /* ------------------------------ Tròn (donut) ------------------------------ */
  Charts.donut = function (data, opts) {
    const o = Object.assign({ valueKey: 'value', labelKey: 'label', size: 190, thickness: 26, format: 'number', centerLabel: 'Tổng' }, opts || {});
    if (!data || !data.length) return '<div class="empty tiny">Không có dữ liệu</div>';
    const total = data.reduce((s, d) => s + (Number(d[o.valueKey]) || 0), 0) || 1;
    const r = o.size / 2, ir = r - o.thickness;
    let angle = -Math.PI / 2;
    let paths = '';
    data.forEach((d, i) => {
      const val = Number(d[o.valueKey]) || 0;
      const slice = (val / total) * Math.PI * 2;
      const color = d.color || PALETTE[i % PALETTE.length];
      const x1 = r + r * Math.cos(angle), y1 = r + r * Math.sin(angle);
      const x2 = r + r * Math.cos(angle + slice), y2 = r + r * Math.sin(angle + slice);
      const ix1 = r + ir * Math.cos(angle), iy1 = r + ir * Math.sin(angle);
      const ix2 = r + ir * Math.cos(angle + slice), iy2 = r + ir * Math.sin(angle + slice);
      const large = slice > Math.PI ? 1 : 0;
      paths += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${ir} ${ir} 0 ${large} 0 ${ix1} ${iy1} Z" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${U.esc(d[o.labelKey])}: ${fmt(val, o.format)} (${U.num((val / total) * 100, 1)}%)</title></path>`;
      angle += slice;
    });
    return `<div class="row wrap" style="gap:18px;align-items:center">
      <svg viewBox="0 0 ${o.size} ${o.size}" style="width:${o.size}px;height:${o.size}px;flex:none">${paths}
        <text x="${r}" y="${r - 3}" text-anchor="middle" font-size="17" font-weight="700" fill="#0f172a" font-family="Inter,sans-serif">${fmt(total, o.format)}</text>
        <text x="${r}" y="${r + 14}" text-anchor="middle" font-size="10" fill="#94a3b8" font-family="Inter,sans-serif">${U.esc(o.centerLabel)}</text>
      </svg>
      <div style="flex:1;min-width:170px">
        ${data.map((d, i) => {
          const val = Number(d[o.valueKey]) || 0;
          return `<div class="row between" style="font-size:12px;padding:3px 0;border-bottom:1px dashed var(--border)">
            <span class="row" style="gap:6px"><span class="sw" style="width:10px;height:10px;border-radius:3px;background:${d.color || PALETTE[i % PALETTE.length]};display:inline-block"></span>${U.esc(d[o.labelKey])}</span>
            <span><b class="mono">${U.num(val)}</b> <span class="muted tiny">(${U.num((val / total) * 100, 1)}%)</span></span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  };

  /* ------------------------------ Thanh tiến độ nhiều phần ------------------------------ */
  Charts.stackedBar = function (data, opts) {
    const o = Object.assign({ height: 16 }, opts || {});
    const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0) || 1;
    return `<div style="display:flex;height:${o.height}px;border-radius:8px;overflow:hidden;border:1px solid var(--border)">
      ${data.map((d, i) => `<div style="width:${((Number(d.value) || 0) / total) * 100}%;background:${d.color || PALETTE[i % PALETTE.length]}" title="${U.attr(d.label)}: ${U.num(d.value)}"></div>`).join('')}
    </div>
    <div class="legend">${data.map((d, i) => `<span class="li"><span class="sw" style="background:${d.color || PALETTE[i % PALETTE.length]}"></span>${U.esc(d.label)} <b>${U.num(d.value)}</b></span>`).join('')}</div>`;
  };

  /* ------------------------------ Sparkline ------------------------------ */
  Charts.spark = function (values, opts) {
    const o = Object.assign({ color: '#2563eb', height: 34, width: 120 }, opts || {});
    if (!values || !values.length) return '';
    const max = Math.max.apply(null, values) || 1;
    const min = Math.min.apply(null, values);
    const step = o.width / Math.max(1, values.length - 1);
    const pts = values.map((v, i) => `${i * step},${o.height - ((v - min) / (max - min || 1)) * (o.height - 6) - 3}`);
    return `<svg viewBox="0 0 ${o.width} ${o.height}" style="width:${o.width}px;height:${o.height}px">
      <polyline points="${pts.join(' ')}" fill="none" stroke="${o.color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  };
})();
