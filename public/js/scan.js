/* ==========================================================================
   scan.js — Quét mã QR / mã vạch bằng điện thoại để kiểm kê nhanh
   ==========================================================================
   Luồng nghiệp vụ:
     1. Chọn đợt kiểm kê đang mở (hoặc mở từ tham số ?stocktake=<id>)
     2. Quét tem tài sản: mã QR (ams://asset/<mã>) hoặc mã vạch Code128 (<mã>)
        - Camera + BarcodeDetector khi trình duyệt hỗ trợ (Chrome/Edge/Android)
        - Nhập tay / dán mã / đọc từ ảnh chụp / quét thử (không cần camera)
     3. Ghi nhận kết quả vào đợt kiểm kê: khớp — sai vị trí — hư hỏng — không tìm thấy
     4. Theo dõi tiến độ, lịch sử quét, hoàn tác và in tem QR cho tài sản vừa quét
   ========================================================================== */
(function () {
  'use strict';

  const U = App.U;
  const API = App.api;
  const Pages = window.Pages;

  /* ---------------------------- Tiện ích ---------------------------- */

  /** Các định dạng mã được hỗ trợ quét */
  const SCAN_FORMATS = ['qr_code', 'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'data_matrix', 'pdf417'];

  const RESULT_LABELS = {
    match: 'Khớp sổ sách',
    wrong_location: 'Sai vị trí',
    damaged: 'Hư hỏng',
    missing: 'Không tìm thấy',
    extra: 'Phát hiện thêm',
  };

  /** Phân tích giá trị quét được (giống phía server, dùng để hiển thị nhanh) */
  function parseScanValue(raw) {
    const value = String(raw == null ? '' : raw).trim();
    const out = { raw: value, kind: 'code', code: '', assetId: null, stocktakeCode: '' };
    if (!value) return out;
    const scheme = value.match(/^ams:\/\/([^\s]+)$/i);
    if (scheme) {
      const parts = scheme[1].split('/').filter(Boolean);
      const head = String(parts[0] || '').toLowerCase();
      if (head === 'stocktake' && parts.length >= 2) {
        out.kind = 'stocktake';
        out.stocktakeCode = decodeURIComponent(parts[1]);
        if (parts[2] === 'asset' && parts[3]) out.assetId = Number(parts[3]) || null;
      } else {
        out.kind = 'asset';
        out.code = decodeURIComponent(parts[1] || parts[0] || '');
      }
    } else {
      out.code = value;
      if (/^\d+$/.test(value)) out.assetId = Number(value);
    }
    return out;
  }

  /** Âm thanh phản hồi khi quét (không bắt buộc, tự bỏ qua nếu trình duyệt chặn) */
  let audioCtx = null;
  function beep(kind) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      const now = audioCtx.currentTime;
      const notes = kind === 'error' ? [320, 260] : kind === 'warn' ? [520] : [1180, 1560];
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + i * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.16, now + i * 0.09 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.08);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.09);
        osc.stop(now + i * 0.09 + 0.09);
      });
    } catch (e) { /* thiết bị không cho phát âm thanh */ }
  }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* bỏ qua */ }
  }

  /* ============================== Trang quét mã ============================== */

  Pages.scan = async function (container) {
    const q = App.state.route.query || {};
    const storeKey = 'ams_scan_stocktake';

    /* --------- Trạng thái --------- */
    const S = {
      stocktakes: [],
      current: null,
      items: [],
      history: [],
      stream: null,
      detector: null,
      timer: null,
      scanning: false,
      autoCount: true,
      busy: false,
      lastCode: '',
      lastAt: 0,
      session: { scans: 0, counted: 0, duplicates: 0, diffs: 0 },
      currentCard: null,
    };

    const qty = (v) => (v === null || v === undefined || v === '' ? '—' : U.num(v));

    /* --------- Khung trang --------- */
    container.innerHTML = `
      <div class="page-head">
        <div>
          <h1>📷 Quét mã kiểm kê</h1>
          <div class="sub">Quét mã QR in trên tem hoặc mã vạch Code128 của tài sản để kiểm kê nhanh bằng điện thoại</div>
        </div>
        <div class="actions">
          <a class="btn ghost" href="#/stocktakes">← Danh sách kiểm kê</a>
          <button class="btn ghost" id="scan-reload">⟳ Nạp lại tiến độ</button>
        </div>
      </div>

      <div class="card scan-toolbar">
        <label class="scan-field"><span>Đợt kiểm kê</span><select id="scan-sk"></select></label>
        <label class="scan-field scan-toggle"><input type="checkbox" id="scan-auto" checked/><span>Tự ghi nhận khi quét (chế độ đếm nhanh)</span></label>
        <div class="spacer" style="flex:1"></div>
        <label class="scan-field scan-toggle"><input type="checkbox" id="scan-sound" checked/><span>Âm thanh</span></label>
        <button class="btn" id="scan-demo">🧪 Quét thử</button>
        <a class="btn ghost" id="scan-open-count" href="#">📋 Màn hình kiểm kê</a>
      </div>

      <div class="scan-grid">
        <div class="card">
          <div class="scan-stage" id="scan-stage">
            <video id="scan-video" playsinline muted autoplay></video>
            <div class="scan-overlay"><div class="scan-frame"><span class="scan-corner tl"></span><span class="scan-corner tr"></span><span class="scan-corner bl"></span><span class="scan-corner br"></span><div class="scan-laser"></div></div></div>
            <div class="scan-placeholder" id="scan-placeholder">📷<div>Camera đang tắt</div></div>
          </div>
          <div class="scan-actions">
            <button class="btn primary" id="scan-start">▶ Bật camera quét</button>
            <button class="btn" id="scan-stop" hidden>⏸ Tắt camera</button>
            <label class="btn ghost" for="scan-file">🖼 Đọc từ ảnh</label>
            <input type="file" id="scan-file" accept="image/*" capture="environment" hidden/>
          </div>
          <div class="scan-status tiny" id="scan-status">Sẵn sàng. Nhập mã tài sản hoặc bật camera để bắt đầu quét.</div>

          <div class="scan-manual">
            <input type="text" id="scan-input" placeholder="Nhập / dán mã tài sản hoặc liên kết ams://…  rồi Enter" autocomplete="off"/>
            <button class="btn primary" id="scan-go">Kiểm tra</button>
          </div>
          <div class="scan-tips" id="scan-tips"></div>
        </div>

        <div>
          <div class="card" id="scan-result-card">
            <div class="scan-result" id="scan-result">
              <div class="scan-idle">🔍<div><b>Sẵn sàng quét</b></div><div class="muted tiny">Kết quả quét sẽ hiện ở đây kèm thao tác ghi nhận kiểm kê.</div></div>
            </div>
          </div>
          <div class="card" id="scan-progress-card"></div>
          <div class="card" id="scan-history-card"></div>
        </div>
      </div>`;

    const $ = (id) => document.getElementById(id);
    const elSk = $('scan-sk');
    const elAuto = $('scan-auto');
    const elSound = $('scan-sound');
    const elInput = $('scan-input');
    const elStatus = $('scan-status');
    const elResult = $('scan-result');
    const elTips = $('scan-tips');
    const video = $('scan-video');
    const elPlaceholder = $('scan-placeholder');
    const btnStart = $('scan-start');
    const btnStop = $('scan-stop');
    const btnDemo = $('scan-demo');

    function setStatus(text, kind) {
      elStatus.className = 'scan-status tiny' + (kind ? ' ' + kind : '');
      elStatus.innerHTML = text;
    }

    function feedback(kind, message) {
      if (elSound.checked) beep(kind);
      if (kind === 'error') vibrate([90, 60, 90]);
      else if (kind === 'warn') vibrate(60);
      else vibrate(40);
      if (message) UI.toast(kind === 'error' ? 'Không ghi nhận được' : kind === 'warn' ? 'Lưu ý' : 'Đã ghi nhận', message, kind === 'error' ? 'danger' : kind === 'warn' ? 'warning' : 'success');
    }

    /* ---------------------- Nạp dữ liệu đợt kiểm kê ---------------------- */

    async function loadStocktakes() {
      let rows = [];
      try {
        const res = await API.get('/api/entities/stocktakes?status=open&limit=60&sort=id&order=desc');
        rows = res.data || [];
      } catch (e) { rows = []; }
      S.stocktakes = rows;
      const saved = String(q.stocktake || App.store.get(storeKey) || '');
      const chosen = rows.find((s) => String(s.id) === saved) || rows[0] || null;
      elSk.innerHTML = rows.length
        ? rows.map((s) => `<option value="${s.id}" ${chosen && String(chosen.id) === String(s.id) ? 'selected' : ''}>${U.esc(s.code)} — ${U.esc(s.name)} (${s.countedItems || 0}/${s.totalItems || 0})</option>`).join('')
        : '<option value="">— Không có đợt kiểm kê đang mở —</option>';
      S.current = chosen;
      $('scan-open-count').setAttribute('href', chosen ? `#/stocktakes/${chosen.id}/count` : '#/stocktakes');
      if (chosen) App.store.set(storeKey, String(chosen.id));
      return chosen;
    }

    async function loadItems() {
      if (!S.current) { S.items = []; return; }
      try {
        const res = await API.get(`/api/entities/stocktakes/${S.current.id}`);
        const info = res.data || {};
        S.currentInfo = info;
        S.items = ((res.meta && res.meta.related && res.meta.related.items) || []);
        S.current = Object.assign({}, S.current, {
          totalItems: info.totalItems, countedItems: info.countedItems, diffItems: info.diffItems, progress: info.progress,
        });
      } catch (e) { S.items = []; }
      renderProgress();
      renderTips();
    }

    async function loadHistory() {
      if (!S.current) { S.history = []; renderHistory(); return; }
      try {
        const res = await API.get(`/api/scan/history?stocktakeId=${S.current.id}&limit=25`);
        S.history = res.data || [];
      } catch (e) { S.history = []; }
      renderHistory();
    }

    /* ---------------------------- Hiển thị ---------------------------- */

    function progressData() {
      const items = S.items || [];
      const counted = items.filter((i) => i.counted);
      const total = items.length;
      return {
        total,
        counted: counted.length,
        remaining: total - counted.length,
        diff: counted.filter((i) => i.result && i.result !== 'match').length,
        progress: total ? Math.round((counted.length / total) * 100) : 0,
      };
    }

    function renderProgress() {
      const skipped = S.items.filter((i) => !i.isDeleted);
      void skipped;
      const p = progressData();
      const s = S.session;
      $('scan-progress-card').innerHTML = `
        <div class="card-title">📊 Tiến độ đợt ${S.current ? '<span class="mono">' + U.esc(S.current.code) + '</span>' : ''}</div>
        <div class="scan-progress">
          <div class="scan-bar"><span style="width:${p.progress}%"></span></div>
          <div class="scan-nums">
            <span><b>${p.counted}</b>/${p.total} đã kiểm kê</span>
            <span class="ok"><b>${p.counted - p.diff}</b> khớp</span>
            <span class="warn"><b>${p.diff}</b> chênh lệch</span>
            <span class="muted"><b>${p.remaining}</b> còn lại</span>
          </div>
        </div>
        <div class="scan-session tiny muted">Phiên quét này: <b>${s.scans}</b> lượt quét • <b>${s.counted}</b> lượt ghi nhận • <b>${s.duplicates}</b> lượt trùng</div>`;
    }

    function renderHistory() {
      const rows = S.history.slice(0, 25);
      $('scan-history-card').innerHTML = `
        <div class="card-title">🕘 Lịch sử quét gần đây
          <span class="muted tiny">${S.current ? U.esc(S.current.code) : ''}</span></div>
        ${rows.length
          ? `<div class="scan-history">${rows.map((h) => `
              <div class="scan-history-row">
                <span class="mono">${U.esc(h.assetCode)}</span>
                <span class="scan-history-name">${U.esc(h.assetName || '')}</span>
                <span class="badge ${h.result === 'match' ? 'b-ok' : 'b-warn'}">${RESULT_LABELS[h.result] || h.result || '—'}</span>
                <span class="muted tiny">${U.datetime(h.countedAt)} • ${U.esc(h.countedByName || '')}</span>
                <button class="btn ghost tiny" data-undo="${h.id}" title="Hoàn tác lượt kiểm kê này">↩</button>
              </div>`).join('')}</div>`
          : '<div class="muted tiny">Chưa có lượt quét nào trong đợt này.</div>'}`;
      $('scan-history-card').querySelectorAll('[data-undo]').forEach((b) => {
        b.onclick = () => undoScan(b.dataset.undo);
      });
    }

    function renderTips() {
      const uncounted = S.items.filter((i) => !i.counted).slice(0, 4);
      elTips.innerHTML = !S.current
        ? '<span class="muted tiny">Chưa có đợt kiểm kê đang mở — hãy tạo/mở một đợt kiểm kê trước.</span>'
        : uncounted.length
          ? '<span class="muted tiny">Gợi ý mã để thử nhanh:</span> ' +
            uncounted.map((i) => `<button class="chip" data-try="${U.attr(i.assetCode)}">${U.esc(i.assetCode)}</button>`).join('')
          : '<span class="muted tiny">Mọi tài sản trong đợt đã được kiểm kê 🎉</span>';
      elTips.querySelectorAll('[data-try]').forEach((b) => {
        b.onclick = () => { elInput.value = b.dataset.try; doLookup(b.dataset.try, { from: 'chip' }); };
      });
    }

    /* ------------------------- Tra cứu & ghi nhận ------------------------- */

    function assetBlock(asset, extra) {
      return `
        <div class="scan-asset">
          <div class="scan-asset-head">
            <div>
              <div class="scan-asset-code mono">${U.esc(asset.code)}</div>
              <div class="scan-asset-name">${U.esc(asset.name)}</div>
            </div>
            <div class="scan-asset-qty">
              <div><span class="muted tiny">SL sổ sách</span><b>${qty(asset.quantity)}</b> ${U.esc(asset.unit || '')}</div>
            </div>
          </div>
          <div class="scan-asset-grid">
            <div><span class="muted tiny">Danh mục</span>${U.esc(asset.categoryName || '—')}</div>
            <div><span class="muted tiny">Bộ phận</span>${U.esc(asset.departmentName || '—')}</div>
            <div><span class="muted tiny">Người sử dụng</span>${U.esc(asset.assigneeName || '—')}</div>
            <div><span class="muted tiny">Vị trí</span>${U.esc(asset.locationName || '—')}</div>
            <div><span class="muted tiny">Tình trạng</span>${U.esc(asset.conditionLabel || asset.condition || '—')}</div>
            <div><span class="muted tiny">Trạng thái</span>${U.esc(asset.statusLabel || asset.status || '—')}</div>
          </div>
          ${extra || ''}
        </div>`;
    }

    function showNotFound(parsed, suggestions) {
      elResult.innerHTML = `
        <div class="scan-banner danger">⚠️ Không tìm thấy tài sản với mã <span class="mono">${U.esc(parsed.raw)}</span></div>
        <div class="muted tiny">Mã đã quét không khớp mã tài sản, số sê-ri hay liên kết tem nào trong hệ thống.</div>
        ${(suggestions && suggestions.length) ? `<div class="scan-actions-row">${suggestions.map((s) => `<button class="chip" data-sug="${U.attr(s.code)}">${U.esc(s.code)} — ${U.esc(String(s.name || '').slice(0, 34))}</button>`).join('')}</div>` : ''}
        <div class="scan-actions-row">
          <a class="btn ghost" href="#/assets/new">➕ Tạo tài sản mới</a>
          <a class="btn ghost" href="#/assets">📦 Danh sách tài sản</a>
        </div>`;
      elResult.querySelectorAll('[data-sug]').forEach((b) => { b.onclick = () => doLookup(b.dataset.sug); });
      feedback('error', 'Mã ' + parsed.raw + ' không có trong hệ thống');
    }

    function showAsset(data, parsed) {
      const asset = data.asset;
      const item = data.item;
      const st = data.stocktake;
      S.currentCard = { asset, item, parsed };
      const dup = data.alreadyCounted
        ? `<div class="scan-banner warn">🔁 Tài sản này đã được kiểm kê${data.countedAt ? ' lúc ' + U.datetime(data.countedAt) : ''}${data.countedByName ? ' bởi ' + U.esc(data.countedByName) : ''}. Quét lại sẽ cập nhật kết quả.</div>`
        : data.inStocktakeList
          ? '<div class="scan-banner ok">✅ Tài sản có trong danh sách kiểm kê của đợt này.</div>'
          : '<div class="scan-banner warn">➕ Tài sản chưa có trong danh sách kiểm kê — ghi nhận sẽ đánh dấu là <b>phát hiện thêm</b>.</div>';
      const prev = item && item.counted
        ? `<div class="muted tiny">Kết quả gần nhất: <b>${RESULT_LABELS[item.result] || item.result}</b>${item.note ? ' • ' + U.esc(item.note) : ''}</div>`
        : '';
      elResult.innerHTML = `
        ${dup}
        ${assetBlock(asset, prev)}
        <div class="scan-result-actions">
          <button class="btn primary" data-act="match">✅ Khớp sổ sách</button>
          <button class="btn" data-act="wrong_location">📍 Sai vị trí</button>
          <button class="btn" data-act="damaged">🛠 Hư hỏng</button>
          <button class="btn danger" data-act="missing">❌ Không tìm thấy</button>
        </div>
        <div class="scan-actions-row">
          <input type="text" id="scan-note" placeholder="Ghi chú (không bắt buộc)…" value="${U.attr(item && item.note ? item.note : '')}" style="flex:1"/>
          <label class="scan-field scan-toggle"><span class="muted tiny">SL kiểm kê</span><input type="number" id="scan-qty" min="0" step="1" style="width:80px" value="${U.attr(item && item.countedQty !== undefined && item.countedQty !== null ? item.countedQty : (asset.quantity || 1))}"/></label>
        </div>
        <div class="scan-actions-row">
          <button class="btn ghost" data-goto="1">👁 Mở hồ sơ tài sản</button>
          <button class="btn ghost" data-label="1">🖨 In tem QR</button>
          ${st ? `<span class="muted tiny">Đợt <span class="mono">${U.esc(st.code)}</span>: ${st.countedItems}/${st.totalItems} (${st.progress}%)</span>` : ''}
        </div>`;
      elResult.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => recordScan(asset, b.dataset.act); });
      elResult.querySelector('[data-goto]').onclick = () => App.Router.navigate('/assets/' + asset.id);
      elResult.querySelector('[data-label]').onclick = () => API.openHTML('/api/documents/label/' + asset.id);
    }

    function showRecorded(asset, item) {
      const okKind = item.result && item.result !== 'match';
      elResult.innerHTML = `
        <div class="scan-banner ${okKind ? 'warn' : 'ok'}">${okKind ? '⚠️' : '✅'} Đã ghi nhận <span class="mono">${U.esc(asset.code)}</span> — <b>${RESULT_LABELS[item.result] || item.result}</b>
          ${item.countedQty !== undefined && item.countedQty !== null ? ' • SL kiểm kê: <b>' + U.num(item.countedQty) + '</b>' : ''}</div>
        ${assetBlock(asset, `<div class="muted tiny">Ghi nhận lúc ${U.datetime(item.countedAt)}${item.note ? ' • ' + U.esc(item.note) : ''}</div>`)}
        <div class="scan-actions-row">
          <span class="muted tiny">Đổi kết quả:</span>
          <button class="btn ghost" data-act="match">✅ Khớp</button>
          <button class="btn ghost" data-act="wrong_location">📍 Sai vị trí</button>
          <button class="btn ghost" data-act="damaged">🛠 Hư hỏng</button>
          <button class="btn ghost" data-act="missing">❌ Không tìm thấy</button>
        </div>
        <div class="scan-actions-row">
          <button class="btn ghost" data-label="1">🖨 In tem QR</button>
          <button class="btn ghost" data-goto="1">👁 Mở hồ sơ</button>
          <button class="btn ghost" data-undo="${item.id}">↩ Hoàn tác</button>
          <button class="btn" id="scan-next">➡ Quét tiếp</button>
        </div>`;
      elResult.querySelector('[data-label]').onclick = () => API.openHTML('/api/documents/label/' + asset.id);
      elResult.querySelector('[data-goto]').onclick = () => App.Router.navigate('/assets/' + asset.id);
      elResult.querySelector('[data-undo]').onclick = () => undoScan(item.id);
      elResult.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => recordScan(asset, b.dataset.act); });
      elResult.querySelector('#scan-next').onclick = () => { elResult.querySelector('.scan-banner'); elInput.value = ''; elInput.focus(); };
    }

    function showError(message) {
      elResult.innerHTML = `<div class="scan-banner danger">⚠️ ${U.esc(message)}</div>
        <div class="muted tiny">Kiểm tra đợt kiểm kê đang chọn, mã trên tem hoặc tạo đợt kiểm kê mới.</div>`;
    }

    /** Tra cứu mã (không ghi nhận) */
    async function doLookup(raw, opts) {
      const o = opts || {};
      const value = String(raw || '').trim();
      if (!value) { UI.toast('Chưa có mã', 'Hãy nhập hoặc quét mã tài sản', 'warning'); return; }
      const now = Date.now();
      if (!o.force && value === S.lastCode && now - S.lastAt < 1500) return; // bỏ qua mã lặp trong 1,5 giây
      S.lastCode = value; S.lastAt = now;
      if (S.busy) return;
      S.busy = true;
      S.session.scans++;
      try {
        const parsed = parseScanValue(value);
        // Mã kiểm kê trong QR (ams://stocktake/<mã>/asset/<id>): tự chuyển đợt nếu cần
        if (parsed.kind === 'stocktake' && parsed.stocktakeCode) {
          const match = S.stocktakes.find((s) => String(s.code).toUpperCase() === String(parsed.stocktakeCode).toUpperCase());
          if (match && (!S.current || String(match.id) !== String(S.current.id))) {
            S.current = match; elSk.value = String(match.id);
            App.store.set(storeKey, String(match.id));
            await loadItems(); await loadHistory();
            setStatus('Đã chuyển sang đợt kiểm kê <b class="mono">' + U.esc(match.code) + '</b> theo mã QR.', 'ok');
          }
        }
        const url = '/api/scan/lookup?code=' + encodeURIComponent(value) + (S.current ? '&stocktakeId=' + S.current.id : '');
        const res = await API.get(url);
        const data = res.data || {};
        if (!data.asset) {
          S.session.diffs++;
          showNotFound(data.parsed || parsed, data.suggestions);
          return;
        }
        showAsset(data, data.parsed || parsed);
        if (data.alreadyCounted) S.session.duplicates++;
        setStatus(`Đã đọc mã <b class="mono">${U.esc(data.asset.code)}</b> — ${data.alreadyCounted ? 'đã kiểm kê trước đó' : 'chưa kiểm kê'}.`, data.alreadyCounted ? 'warn' : 'ok');
        // Chế độ đếm nhanh: quét là ghi nhận luôn (mặc định khớp)
        if (S.autoCount && (o.from === 'camera' || o.from === 'demo' || o.from === 'chip')) {
          await recordScan(data.asset, 'match', { silent: true });
        } else if (S.autoCount && o.from === 'manual') {
          await recordScan(data.asset, 'match', { silent: true });
        }
      } catch (e) {
        showError(e.message || 'Lỗi tra cứu mã');
        feedback('error', e.message || 'Lỗi tra cứu');
      } finally {
        S.busy = false;
        renderProgress();
      }
    }

    /** Ghi nhận kết quả kiểm kê cho tài sản vừa quét */
    async function recordScan(asset, result, opts) {
      const o = opts || {};
      if (!S.current) { UI.toast('Chưa chọn đợt kiểm kê', 'Hãy chọn hoặc tạo một đợt kiểm kê đang mở', 'warning'); return; }
      const noteEl = $('scan-note');
      const qtyEl = $('scan-qty');
      const body = {
        stocktakeId: S.current.id,
        code: asset.code,
        result,
        note: noteEl ? noteEl.value : '',
      };
      if (qtyEl && qtyEl.value !== '') body.countedQty = Number(qtyEl.value);
      try {
        const res = await API.post('/api/scan/count', body);
        const d = res.data || {};
        S.session.counted++;
        if (result !== 'match') S.session.diffs++;
        // Cập nhật cục bộ danh sách để tiến độ phản ánh ngay
        const local = S.items.find((i) => String(i.assetId) === String(asset.id));
        const item = d.item || {};
        if (local) Object.assign(local, { counted: true, result: item.result || result, countedAt: item.countedAt, countedQty: item.countedQty });
        else S.items.push({ id: item.id, assetId: asset.id, assetCode: asset.code, assetName: asset.name, counted: true, result: item.result || result, countedQty: item.countedQty });
        if (d.createdItem) setStatus('Đã thêm tài sản ngoài danh sách vào đợt kiểm kê (phát hiện thêm).', 'warn');
        showRecorded(d.asset || asset, item);
        renderProgress();
        if (!o.silent) feedback(result === 'match' ? 'ok' : 'warn', `${asset.code} — ${RESULT_LABELS[result] || result}`);
        else feedback(result === 'match' ? 'ok' : 'warn', `${asset.code} — ${RESULT_LABELS[result] || result}`);
        S.history.unshift(item);
        renderHistory();
      } catch (e) {
        showError(e.message || 'Lỗi ghi nhận kiểm kê');
        feedback('error', e.message || 'Lỗi ghi nhận');
      }
    }

    /** Hoàn tác một lượt kiểm kê */
    async function undoScan(itemId) {
      if (!S.current) return;
      const yes = await UI.confirm({
        title: 'Hoàn tác lượt kiểm kê',
        message: 'Bỏ đánh dấu “đã kiểm kê” cho dòng này? Tài sản sẽ trở lại trạng thái chưa kiểm kê.',
        confirmText: 'Hoàn tác', danger: true,
      });
      if (!yes) return;
      try {
        await API.post(`/api/stocktakes/${S.current.id}/items/${itemId}`, { counted: false });
        const local = S.items.find((i) => String(i.id) === String(itemId));
        if (local) { local.counted = false; local.countedQty = null; local.countedAt = null; }
        S.history = S.history.filter((h) => String(h.id) !== String(itemId));
        renderHistory(); renderProgress();
        UI.toast('Đã hoàn tác', 'Dòng kiểm kê trở về trạng thái chưa kiểm kê', 'success');
      } catch (e) { UI.toast('Không hoàn tác được', e.message, 'danger'); }
    }

    /* ------------------------------ Camera ------------------------------ */

    function detectorFormats() {
      try {
        const supported = (window.BarcodeDetector && BarcodeDetector.getSupportedFormats) ? BarcodeDetector.getSupportedFormats() : [];
        if (!supported || !supported.length) return SCAN_FORMATS;
        const list = SCAN_FORMATS.filter((f) => supported.indexOf(f) >= 0);
        return list.length ? list : SCAN_FORMATS;
      } catch (e) { return SCAN_FORMATS; }
    }

    async function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Trình duyệt không hỗ trợ camera (cần HTTPS hoặc localhost). Dùng ô nhập mã hoặc nút <b>Quét thử</b>.', 'warn');
        UI.toast('Không mở được camera', 'Trình duyệt chặn camera hoặc trang không chạy trên HTTPS/localhost. Bạn vẫn có thể nhập mã thủ công.', 'warning');
        return;
      }
      try {
        setStatus('Đang xin quyền camera…');
        S.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        video.srcObject = S.stream;
        try { await video.play(); } catch (e) { /* một số trình duyệt tự phát */ }
        elPlaceholder.style.display = 'none';
        btnStart.hidden = true;
        btnStop.hidden = false;
        S.scanning = true;
        if (window.BarcodeDetector) {
          S.detector = new BarcodeDetector({ formats: detectorFormats() });
          setStatus('Camera đang bật — đưa mã QR/Code128 vào khung để quét.', 'ok');
          S.timer = setInterval(detectFrame, 320);
        } else {
          setStatus('Camera đã bật nhưng trình duyệt không hỗ trợ đọc mã tự động (<span class="mono">BarcodeDetector</span>). Hãy dùng <b>Đọc từ ảnh</b>, nhập mã hoặc nút <b>Quét thử</b>.', 'warn');
        }
      } catch (e) {
        setStatus('Không truy cập được camera: ' + U.esc(e.message || e.name || 'bị từ chối') + '. Dùng ô nhập mã hoặc <b>Quét thử</b>.', 'warn');
        UI.toast('Không mở được camera', e.message || 'Quyền truy cập camera bị từ chối', 'warning');
      }
    }

    async function detectFrame() {
      if (!S.detector || !video || video.readyState < 2) return;
      try {
        const codes = await S.detector.detect(video);
        if (codes && codes.length) {
          const value = codes[0].rawValue;
          const parsed = parseScanValue(value);
          setStatus(`Đã quét: <b class="mono">${U.esc(parsed.code || value)}</b> (${codes[0].format})`);
          doLookup(value, { from: 'camera' });
        }
      } catch (e) { /* khung hình chưa sẵn sàng */ }
    }

    function stopCamera() {
      if (S.timer) { clearInterval(S.timer); S.timer = null; }
      S.detector = null;
      S.scanning = false;
      if (S.stream && S.stream.getTracks) S.stream.getTracks().forEach((t) => t.stop());
      S.stream = null;
      try { video.srcObject = null; } catch (e) { /* bỏ qua */ }
      elPlaceholder.style.display = '';
      btnStart.hidden = false;
      btnStop.hidden = true;
      setStatus('Camera đã tắt.');
    }

    /** Đọc mã từ ảnh chụp / ảnh trong thư viện */
    async function decodeFile(file) {
      if (!file) return;
      if (!window.BarcodeDetector) {
        UI.toast('Không đọc được ảnh', 'Trình duyệt không hỗ trợ BarcodeDetector. Hãy nhập mã tài sản in trên tem.', 'warning');
        return;
      }
      try {
        const bitmap = await createImageBitmap(file);
        const det = new BarcodeDetector({ formats: detectorFormats() });
        const codes = await det.detect(bitmap);
        if (!codes || !codes.length) {
          UI.toast('Không thấy mã trong ảnh', 'Hãy chụp gần hơn, đủ sáng và lấy trọn mã QR/mã vạch', 'warning');
          feedback('error');
          return;
        }
        setStatus(`Đọc từ ảnh: <b class="mono">${U.esc(parseScanValue(codes[0].rawValue).code || codes[0].rawValue)}</b>`);
        doLookup(codes[0].rawValue, { from: 'image', force: true });
      } catch (e) {
        UI.toast('Không đọc được ảnh', e.message || 'Lỗi xử lý ảnh', 'danger');
      }
    }

    /** Quét thử không cần camera: lấy tài sản chưa kiểm kê kế tiếp của đợt */
    function demoScan() {
      if (!S.current) { UI.toast('Chưa có đợt kiểm kê', 'Hãy mở một đợt kiểm kê đang mở trước', 'warning'); return; }
      const next = S.items.find((i) => !i.counted);
      if (!next) { UI.toast('Đã kiểm kê hết', 'Mọi tài sản trong đợt đều đã được kiểm kê', 'success'); return; }
      elInput.value = next.assetCode;
      setStatus(`Quét thử (mô phỏng): <b class="mono">${U.esc(next.assetCode)}</b> — ${U.esc(next.assetName || '')}`);
      doLookup(next.assetCode, { from: 'demo', force: true });
    }

    /* ------------------------------ Sự kiện ------------------------------ */

    elSk.onchange = async () => {
      S.current = S.stocktakes.find((s) => String(s.id) === elSk.value) || null;
      if (S.current) App.store.set(storeKey, String(S.current.id));
      $('scan-open-count').setAttribute('href', S.current ? `#/stocktakes/${S.current.id}/count` : '#/stocktakes');
      S.session = { scans: 0, counted: 0, duplicates: 0, diffs: 0 };
      setStatus('Đã chọn đợt kiểm kê ' + (S.current ? '<b class="mono">' + U.esc(S.current.code) + '</b>' : 'không'));
      await loadItems();
      await loadHistory();
    };

    elAuto.onchange = () => {
      S.autoCount = elAuto.checked;
      setStatus(S.autoCount
        ? 'Chế độ đếm nhanh: mỗi lần quét sẽ tự ghi nhận kết quả <b>khớp sổ sách</b>.'
        : 'Chế độ xác nhận: sau khi quét, chọn kết quả rồi mới ghi nhận.');
    };

    $('scan-start').onclick = startCamera;
    $('scan-stop').onclick = stopCamera;
    btnDemo.onclick = demoScan;
    $('scan-file').onchange = (e) => decodeFile(e.target.files && e.target.files[0]);
    $('scan-go').onclick = () => doLookup(elInput.value, { from: 'manual', force: true });
    $('scan-reload').onclick = async () => { await loadItems(); await loadHistory(); UI.toast('Đã nạp lại', 'Tiến độ kiểm kê đã được cập nhật', 'success'); };
    elInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doLookup(elInput.value, { from: 'manual', force: true }); }
      if (e.key === 'Escape') elInput.value = '';
    });

    /* Kéo–thả ảnh chứa mã vào khung camera để đọc */
    const stage = $('scan-stage');
    ['dragover', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => e.preventDefault()));
    stage.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) decodeFile(f);
    });

    /* --------------------------- Khởi động --------------------------- */

    const hasDetector = !!window.BarcodeDetector;
    if (!hasDetector) {
      setStatus('Trình duyệt này không có bộ đọc mã tự động (<span class="mono">BarcodeDetector</span>). Bạn vẫn quét được bằng ô nhập mã, nút <b>Quét thử</b> hoặc dùng Chrome/Edge trên Android.', 'warn');
    }

    await loadStocktakes();
    await loadItems();
    await loadHistory();
    elInput.focus();

    // Deep link: #/scan?code=TS-2026-00001 (quét tem bằng camera hệ điều hành)
    if (q.code) {
      elInput.value = q.code;
      await doLookup(q.code, { from: 'deeplink', force: true });
    }

    // Dọn tài nguyên khi rời trang
    Pages._scanCleanup = () => stopCamera();
  };
})();
