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

   Mở rộng (quét liên tục nâng cao):
     - Nhiều người quét song song: mỗi người quét bằng tài khoản của mình,
       bảng "Theo người quét" tổng hợp trực tiếp (tự đồng bộ 6 giây/lần)
     - Đếm nhanh theo nhóm tài sản: bộ đếm theo danh mục / phòng ban
     - Cảnh báo quét trùng: beep + rung + thông báo khi quét lại mã đã kiểm kê
     - Xuất kết quả quét ra Excel/CSV
     - Quét ngay trong màn hình kiểm kê (hộp thoại, không chuyển trang)
     - Quét để tìm tài sản (thanh trên cùng / danh sách tài sản → mở hồ sơ)
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

  function detectorFormats() {
    try {
      const supported = (window.BarcodeDetector && BarcodeDetector.getSupportedFormats) ? BarcodeDetector.getSupportedFormats() : [];
      if (!supported || !supported.length) return SCAN_FORMATS;
      const list = SCAN_FORMATS.filter((f) => supported.indexOf(f) >= 0);
      return list.length ? list : SCAN_FORMATS;
    } catch (e) { return SCAN_FORMATS; }
  }

  /**
   * Bộ quét camera dùng chung (trang quét + các hộp thoại quét):
   *   const scanner = makeScanner({stream:null,detector:null,timer:null,scanning:false}, videoEl, {onCode, onStatus})
   *   scanner.start() → Promise<boolean>; scanner.stop(); scanner.decodeFile(file) → Promise<string|null>
   */
  function makeScanner(state, video, handlers) {
    function start() {
      return new Promise((resolve) => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          handlers.onStatus('Trình duyệt không hỗ trợ camera (cần HTTPS hoặc localhost). Dùng ô nhập mã hoặc nút <b>Quét thử</b>.', 'warn');
          resolve(false);
          return;
        }
        handlers.onStatus('Đang xin quyền camera…');
        navigator.mediaDevices
          .getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          })
          .then((stream) => {
            state.stream = stream;
            video.srcObject = stream;
            return video.play().catch(() => {});
          })
          .then(() => {
            state.scanning = true;
            if (window.BarcodeDetector) {
              state.detector = new BarcodeDetector({ formats: detectorFormats() });
              handlers.onStatus('Camera đang bật — đưa mã QR/Code128 vào khung để quét.', 'ok');
              state.timer = setInterval(detect, 320);
            } else {
              handlers.onStatus('Camera đã bật nhưng trình duyệt không hỗ trợ đọc mã tự động (<span class="mono">BarcodeDetector</span>). Hãy dùng <b>Đọc từ ảnh</b>, nhập mã hoặc nút <b>Quét thử</b>.', 'warn');
            }
            resolve(true);
          })
          .catch((e) => {
            handlers.onStatus('Không truy cập được camera: ' + U.esc(e.message || e.name || 'bị từ chối') + '. Dùng ô nhập mã hoặc <b>Quét thử</b>.', 'warn');
            resolve(false);
          });
      });
    }

    async function detect() {
      if (!state.detector || video.readyState < 2) return;
      try {
        const codes = await state.detector.detect(video);
        if (codes && codes.length) handlers.onCode(codes[0].rawValue, codes[0].format);
      } catch (e) { /* khung hình chưa sẵn sàng */ }
    }

    function stop() {
      if (state.timer) { clearInterval(state.timer); state.timer = null; }
      state.detector = null;
      state.scanning = false;
      if (state.stream && state.stream.getTracks) state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
      try { video.srcObject = null; } catch (e) { /* bỏ qua */ }
    }

    async function decodeFile(file) {
      if (!file) return null;
      if (!window.BarcodeDetector) return null;
      const bitmap = await createImageBitmap(file);
      const det = new BarcodeDetector({ formats: detectorFormats() });
      const codes = await det.detect(bitmap);
      return codes && codes.length ? codes[0].rawValue : null;
    }

    return { start, stop, decodeFile, get scanning() { return !!state.scanning; } };
  }

  /** Khối thông tin tài sản dùng chung (kết quả quét) */
  function assetBlock(asset, extra, qty) {
    const q = qty || ((v) => (v === null || v === undefined || v === '' ? '—' : U.num(v)));
    return `
      <div class="scan-asset">
        <div class="scan-asset-head">
          <div>
            <div class="scan-asset-code mono">${U.esc(asset.code)}</div>
            <div class="scan-asset-name">${U.esc(asset.name)}</div>
          </div>
          <div class="scan-asset-qty">
            <div><span class="muted tiny">SL sổ sách</span><b>${q(asset.quantity)}</b> ${U.esc(asset.unit || '')}</div>
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
      scanner: null,
      autoCount: true,
      live: true,
      syncTimer: null,
      busy: false,
      lastCode: '',
      lastAt: 0,
      assetMeta: {},
      session: { scans: 0, counted: 0, duplicates: 0, diffs: 0 },
      groups: { cat: {}, dept: {} },
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
        <label class="scan-field scan-toggle"><input type="checkbox" id="scan-live" checked/><span>🟢 Đồng bộ trực tiếp</span></label>
        <div class="spacer" style="flex:1"></div>
        <label class="scan-field scan-toggle"><input type="checkbox" id="scan-sound" checked/><span>Âm thanh</span></label>
        <button class="btn" id="scan-demo">🧪 Quét thử</button>
        <button class="btn" id="scan-export" title="Xuất kết quả quét của đợt kiểm kê đang chọn ra Excel">⬇ Xuất Excel</button>
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
    const elLive = $('scan-live');
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
      const saved = String(q.stocktake || localStorage.getItem(storeKey) || '');
      const chosen = rows.find((s) => String(s.id) === saved) || rows[0] || null;
      elSk.innerHTML = rows.length
        ? rows.map((s) => `<option value="${s.id}" ${chosen && String(chosen.id) === String(s.id) ? 'selected' : ''}>${U.esc(s.code)} — ${U.esc(s.name)} (${s.countedItems || 0}/${s.totalItems || 0})</option>`).join('')
        : '<option value="">— Không có đợt kiểm kê đang mở —</option>';
      S.current = chosen;
      $('scan-open-count').setAttribute('href', chosen ? `#/stocktakes/${chosen.id}/count` : '#/stocktakes');
      if (chosen) localStorage.setItem(storeKey, String(chosen.id));
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
      if (S.items.length && !Object.keys(S.assetMeta).length) await loadAssetMeta();
      renderProgress();
      renderTips();
    }

    async function loadAssetMeta() {
      try {
        const res = await API.get('/api/entities/assets?limit=1000&sort=id&order=asc');
        const m = {};
        (res.data || []).forEach((a) => { m[String(a.id)] = a; });
        S.assetMeta = m;
      } catch (e) { S.assetMeta = {}; }
    }

    async function loadHistory() {
      if (!S.current) { S.history = []; renderHistory(); return; }
      try {
        const res = await API.get(`/api/scan/history?stocktakeId=${S.current.id}&limit=25`);
        S.history = res.data || [];
      } catch (e) { S.history = []; }
      renderHistory();
    }

    /* ----------------- Đồng bộ trực tiếp (nhiều người quét) ----------------- */

    function startSync() {
      stopSync();
      if (S.live && S.current) {
        S.syncTimer = setInterval(() => {
          if (!S.current || !document.getElementById('scan-sk')) return;
          loadItems();
          loadHistory();
        }, 6000);
      }
    }
    function stopSync() {
      if (S.syncTimer) { clearInterval(S.syncTimer); S.syncTimer = null; }
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

    /** Tổng hợp lượt quét theo người quét (nhiều người quét song song) */
    function usersAgg() {
      const m = {};
      (S.items || []).forEach((i) => {
        if (i.counted && i.countedByName) {
          const u = m[i.countedByName] = m[i.countedByName] || { total: 0, diff: 0 };
          u.total++;
          if (i.result && i.result !== 'match') u.diff++;
        }
      });
      return Object.keys(m).map((name) => ({ name, total: m[name].total, diff: m[name].diff })).sort((a, b) => b.total - a.total);
    }

    /** Tiến độ tổng thể theo danh mục tài sản (nhóm) */
    function groupsAgg() {
      const g = {};
      (S.items || []).forEach((i) => {
        const a = S.assetMeta[String(i.assetId)];
        const cat = (a && a.categoryName) || 'Khác';
        const u = g[cat] = g[cat] || { total: 0, counted: 0, diff: 0 };
        u.total++;
        if (i.counted) u.counted++;
        if (i.counted && i.result && i.result !== 'match') u.diff++;
      });
      return Object.keys(g).map((k) => ({ name: k, total: g[k].total, counted: g[k].counted, diff: g[k].diff })).sort((a, b) => b.total - a.total);
    }

    function groupChips() {
      const cat = Object.keys(S.groups.cat).map((k) => `<span class="chip" title="Đã quét trong phiên này">${U.esc(k)}: <b>${S.groups.cat[k]}</b></span>`).join('');
      const dept = Object.keys(S.groups.dept).map((k) => `<span class="chip muted-chip" title="Đã quét trong phiên này">${U.esc(k)}: <b>${S.groups.dept[k]}</b></span>`).join('');
      if (!cat && !dept) return '';
      return `<div class="muted tiny" style="margin-top:8px">Đếm nhanh theo nhóm (phiên này)</div>
        <div class="scan-chips">${cat}${dept}</div>`;
    }

    function renderProgress() {
      const p = progressData();
      const s = S.session;
      const users = usersAgg();
      const groups = groupsAgg().slice(0, 8);
      $('scan-progress-card').innerHTML = `
        <div class="card-title">📊 Tiến độ đợt ${S.current ? '<span class="mono">' + U.esc(S.current.code) + '</span>' : ''}
          ${S.live && S.current ? '<span class="scan-live tiny muted" style="margin-left:8px"><span class="scan-live-dot"></span>đang đồng bộ trực tiếp</span>' : ''}
        </div>
        <div class="scan-progress">
          <div class="scan-bar"><span style="width:${p.progress}%"></span></div>
          <div class="scan-nums">
            <span><b>${p.counted}</b>/${p.total} đã kiểm kê</span>
            <span class="ok"><b>${p.counted - p.diff}</b> khớp</span>
            <span class="warn"><b>${p.diff}</b> chênh lệch</span>
            <span class="muted"><b>${p.remaining}</b> còn lại</span>
          </div>
        </div>
        <div class="scan-session tiny muted">Phiên quét này: <b>${s.scans}</b> lượt quét • <b>${s.counted}</b> lượt ghi nhận • <b>${s.duplicates}</b> lượt trùng</div>
        ${groupChips()}
        ${users.length ? `
        <div class="muted tiny" style="margin-top:10px">👥 Theo người quét (cập nhật trực tiếp)</div>
        <div class="table-wrap" style="margin-top:4px"><table class="data compact">
          <thead><tr><th>Người quét</th><th class="num">Đã quét</th><th class="num">Chênh lệch</th></tr></thead>
          <tbody>${users.map((u) => `<tr><td>${U.esc(u.name)}</td><td class="num"><b>${u.total}</b></td><td class="num">${u.diff ? '<span class="warn">' + u.diff + '</span>' : '0'}</td></tr>`).join('')}</tbody>
        </table></div>` : ''}
        ${groups.length ? `
        <div class="muted tiny" style="margin-top:10px">📦 Tiến độ theo nhóm tài sản (danh mục)</div>
        <div class="table-wrap" style="margin-top:4px"><table class="data compact">
          <thead><tr><th>Danh mục</th><th class="num">Tổng</th><th class="num">Đã kiểm kê</th><th class="num">Chênh lệch</th></tr></thead>
          <tbody>${groups.map((g) => `<tr><td>${U.esc(g.name)}</td><td class="num">${g.total}</td><td class="num">${g.counted}</td><td class="num">${g.diff ? '<span class="warn">' + g.diff + '</span>' : '0'}</td></tr>`).join('')}</tbody>
        </table></div>` : ''}`;
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
        ? `<div class="scan-banner warn flash">🔁 Cảnh báo quét trùng: tài sản này đã được kiểm kê${data.countedAt ? ' lúc ' + U.datetime(data.countedAt) : ''}${data.countedByName ? ' bởi ' + U.esc(data.countedByName) : ''}. Quét lại sẽ cập nhật kết quả.</div>`
        : data.inStocktakeList
          ? '<div class="scan-banner ok">✅ Tài sản có trong danh sách kiểm kê của đợt này.</div>'
          : '<div class="scan-banner warn">➕ Tài sản chưa có trong danh sách kiểm kê — ghi nhận sẽ đánh dấu là <b>phát hiện thêm</b>.</div>';
      const prev = item && item.counted
        ? `<div class="muted tiny">Kết quả gần nhất: <b>${RESULT_LABELS[item.result] || item.result}</b>${item.note ? ' • ' + U.esc(item.note) : ''}</div>`
        : '';
      elResult.innerHTML = `
        ${dup}
        ${assetBlock(asset, prev, qty)}
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
        ${assetBlock(asset, `<div class="muted tiny">Ghi nhận lúc ${U.datetime(item.countedAt)}${item.note ? ' • ' + U.esc(item.note) : ''}</div>`, qty)}
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
            localStorage.setItem(storeKey, String(match.id));
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
        if (data.alreadyCounted) {
          S.session.duplicates++;
          feedback('warn', 'Quét trùng: ' + data.asset.code + ' đã kiểm kê' + (data.countedByName ? ' bởi ' + data.countedByName : ''));
        }
        showAsset(data, data.parsed || parsed);
        setStatus(`Đã đọc mã <b class="mono">${U.esc(data.asset.code)}</b> — ${data.alreadyCounted ? '⚠️ ĐÃ KIỂM KÊ TRƯỚC (quét trùng)' : 'chưa kiểm kê'}.`, data.alreadyCounted ? 'warn' : 'ok');
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
        // Đếm nhanh theo nhóm (danh mục / phòng ban của tài sản vừa quét)
        if (asset.categoryName) S.groups.cat[asset.categoryName] = (S.groups.cat[asset.categoryName] || 0) + 1;
        if (asset.departmentName) S.groups.dept[asset.departmentName] = (S.groups.dept[asset.departmentName] || 0) + 1;
        // Cập nhật cục bộ danh sách để tiến độ phản ánh ngay
        const local = S.items.find((i) => String(i.assetId) === String(asset.id));
        const item = d.item || {};
        if (local) Object.assign(local, { counted: true, result: item.result || result, countedAt: item.countedAt, countedQty: item.countedQty });
        else S.items.push({ id: item.id, assetId: asset.id, assetCode: asset.code, assetName: asset.name, counted: true, result: item.result || result, countedQty: item.countedQty, countedAt: item.countedAt });
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

    S.scanner = makeScanner({ stream: null, detector: null, timer: null, scanning: false }, video, {
      onCode: (value, format) => {
        const parsed = parseScanValue(value);
        setStatus(`Đã quét: <b class="mono">${U.esc(parsed.code || value)}</b> (${format || 'mã'})`);
        doLookup(value, { from: 'camera' });
      },
      onStatus: (text, kind) => {
        setStatus(text, kind);
        if (kind === 'ok') {
          elPlaceholder.style.display = 'none';
          btnStart.hidden = true;
          btnStop.hidden = false;
        }
      },
    });

    // Trạng thái nút start/stop sau khi tắt
    const origStopHint = () => {
      elPlaceholder.style.display = '';
      btnStart.hidden = false;
      btnStop.hidden = true;
    };

    /** Đọc mã từ ảnh chụp / ảnh trong thư viện */
    async function decodeFile(file) {
      if (!file) return;
      if (!window.BarcodeDetector) {
        UI.toast('Không đọc được ảnh', 'Trình duyệt không hỗ trợ BarcodeDetector. Hãy nhập mã tài sản in trên tem.', 'warning');
        return;
      }
      try {
        const value = await S.scanner.decodeFile(file);
        if (!value) {
          UI.toast('Không thấy mã trong ảnh', 'Hãy chụp gần hơn, đủ sáng và lấy trọn mã QR/mã vạch', 'warning');
          feedback('error');
          return;
        }
        setStatus(`Đọc từ ảnh: <b class="mono">${U.esc(parseScanValue(value).code || value)}</b>`);
        doLookup(value, { from: 'image', force: true });
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
      if (S.current) localStorage.setItem(storeKey, String(S.current.id));
      $('scan-open-count').setAttribute('href', S.current ? `#/stocktakes/${S.current.id}/count` : '#/stocktakes');
      S.session = { scans: 0, counted: 0, duplicates: 0, diffs: 0 };
      S.groups = { cat: {}, dept: {} };
      S.assetMeta = {};
      setStatus('Đã chọn đợt kiểm kê ' + (S.current ? '<b class="mono">' + U.esc(S.current.code) + '</b>' : 'không'));
      await loadItems();
      await loadHistory();
      startSync();
    };

    elAuto.onchange = () => {
      S.autoCount = elAuto.checked;
      setStatus(S.autoCount
        ? 'Chế độ đếm nhanh: mỗi lần quét sẽ tự ghi nhận kết quả <b>khớp sổ sách</b>.'
        : 'Chế độ xác nhận: sau khi quét, chọn kết quả rồi mới ghi nhận.');
    };

    elLive.onchange = () => {
      S.live = elLive.checked;
      startSync();
      renderProgress();
      setStatus(S.live ? 'Đang đồng bộ trực tiếp: kết quả của các thiết bị khác sẽ hiện lên sau mỗi 6 giây.' : 'Đã tắt đồng bộ trực tiếp.');
    };

    $('scan-start').onclick = async () => {
      const ok = await S.scanner.start();
      if (!ok) {
        UI.toast('Không mở được camera', 'Trình duyệt chặn camera hoặc trang không chạy trên HTTPS/localhost. Bạn vẫn có thể nhập mã thủ công.', 'warning');
      }
    };
    $('scan-stop').onclick = () => { S.scanner.stop(); origStopHint(); setStatus('Camera đã tắt.'); };
    btnDemo.onclick = demoScan;
    $('scan-file').onchange = (e) => decodeFile(e.target.files && e.target.files[0]);
    $('scan-go').onclick = () => doLookup(elInput.value, { from: 'manual', force: true });
    $('scan-reload').onclick = async () => { await loadItems(); await loadHistory(); UI.toast('Đã nạp lại', 'Tiến độ kiểm kê đã được cập nhật', 'success'); };
    $('scan-export').onclick = async () => {
      if (!S.current) return UI.toast('Chưa chọn đợt kiểm kê', 'Hãy chọn đợt kiểm kê trước khi xuất kết quả', 'warning');
      try {
        const name = await API.download(`/api/scan/export?stocktakeId=${S.current.id}&format=xlsx`);
        UI.toast('Đã xuất Excel', name, 'success');
      } catch (e) { UI.toast('Không xuất được', e.message, 'danger'); }
    };
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
    startSync();
    elInput.focus();

    // Deep link: #/scan?code=TS-2026-00001 (quét tem bằng camera hệ điều hành)
    if (q.code) {
      elInput.value = q.code;
      await doLookup(q.code, { from: 'deeplink', force: true });
    }

    // Dọn tài nguyên khi rời trang (tắt camera + dừng đồng bộ)
    Pages._scanCleanup = () => { S.scanner.stop(); stopSync(); origStopHint(); };
  };

  /* ============================== HỘP THOẠI QUÉT ============================== */

  /**
   * Quét ngay trong màn hình kiểm kê (không chuyển trang):
   *   Pages.scanDialog({ stocktakeId, fixedStocktake, autoCount, onRecord(item, asset, data) })
   */
  Pages.scanDialog = async function (opts) {
    const o = Object.assign({
      title: '📷 Quét mã kiểm kê',
      stocktakeId: null,
      fixedStocktake: false,
      autoCount: true,
      onRecord: null,
    }, opts || {});

    const S = {
      stocktakes: [],
      current: null,
      items: [],
      scanner: null,
      autoCount: o.autoCount,
      sound: true,
      busy: false,
      lastCode: '',
      lastAt: 0,
      closed: false,
      session: { scans: 0, counted: 0, duplicates: 0 },
      groups: { cat: {}, dept: {} },
      navTimer: null,
    };

    const body = `
      <div class="sd-top">
        ${o.fixedStocktake ? '' : '<label class="scan-field"><span>Đợt kiểm kê</span><select id="sd-sk"></select></label>'}
        <label class="scan-field scan-toggle"><input type="checkbox" id="sd-auto" ${o.autoCount ? 'checked' : ''}/><span>Tự ghi nhận “Khớp” khi quét</span></label>
        <div class="spacer" style="flex:1"></div>
        <label class="scan-field scan-toggle"><input type="checkbox" id="sd-sound" checked/><span>Âm thanh</span></label>
      </div>
      <div class="sd-grid">
        <div>
          <div class="scan-stage" id="sd-stage">
            <video id="sd-video" playsinline muted autoplay></video>
            <div class="scan-overlay"><div class="scan-frame"><span class="scan-corner tl"></span><span class="scan-corner tr"></span><span class="scan-corner bl"></span><span class="scan-corner br"></span><div class="scan-laser"></div></div></div>
            <div class="scan-placeholder" id="sd-placeholder">📷<div>Camera đang tắt</div></div>
          </div>
          <div class="scan-actions">
            <button class="btn primary" id="sd-start">▶ Bật camera</button>
            <button class="btn" id="sd-stop" hidden>⏸ Tắt</button>
            <label class="btn ghost" for="sd-file">🖼 Đọc từ ảnh</label>
            <input type="file" id="sd-file" accept="image/*" capture="environment" hidden/>
            <button class="btn ghost" id="sd-demo">🧪 Quét thử</button>
          </div>
          <div class="scan-status tiny" id="sd-status">Sẵn sàng. Bật camera hoặc nhập mã tài sản rồi Enter.</div>
          <div class="scan-manual">
            <input type="text" id="sd-input" placeholder="Nhập / dán mã tài sản rồi Enter…" autocomplete="off"/>
            <button class="btn primary" id="sd-go">Kiểm tra</button>
          </div>
        </div>
        <div class="sd-side">
          <div class="card" style="padding:12px">
            <div class="scan-result" id="sd-result">
              <div class="scan-idle">🔍<div><b>Chưa quét</b></div><div class="muted tiny">Quét xong hệ thống ghi kết quả ngay vào đợt kiểm kê — không cần chuyển trang.</div></div>
            </div>
          </div>
          <div id="sd-progress"></div>
        </div>
      </div>`;

    const m = UI.modal({
      size: 'lg',
      title: o.title,
      subtitle: 'Quét ngay tại chỗ — kết quả được ghi trực tiếp vào đợt kiểm kê',
      body,
      footer: [{ label: '✕ Đóng', cls: 'ghost', onClick: (mm) => mm.close() }],
      closeOnOverlay: false,
      onClose: () => {
        S.closed = true;
        if (S.scanner) S.scanner.stop();
        if (S.navTimer) { clearTimeout(S.navTimer); S.navTimer = null; }
      },
    });

    const $ = (sel) => m.body.querySelector(sel);
    const elInput = $('#sd-input');
    const elStatus = $('#sd-status');
    const elResult = $('#sd-result');
    const elSk = $('#sd-sk');
    const video = $('#sd-video');
    const elPlaceholder = $('#sd-placeholder');
    const btnStart = $('#sd-start');
    const btnStop = $('#sd-stop');

    function setStatus(text, kind) {
      elStatus.className = 'scan-status tiny' + (kind ? ' ' + kind : '');
      elStatus.innerHTML = text;
    }

    function feedback(kind, message) {
      if (S.sound) beep(kind);
      vibrate(kind === 'error' ? [90, 60, 90] : kind === 'warn' ? 60 : 40);
      if (message) UI.toast(kind === 'error' ? 'Không ghi nhận được' : kind === 'warn' ? 'Lưu ý' : 'Đã ghi nhận', message, kind === 'error' ? 'danger' : kind === 'warn' ? 'warning' : 'success');
    }

    /* --------- Dữ liệu đợt kiểm kê --------- */

    async function loadStocktakes() {
      try {
        const res = await API.get('/api/entities/stocktakes?status=open&limit=60&sort=id&order=desc');
        S.stocktakes = res.data || [];
      } catch (e) { S.stocktakes = []; }
      if (o.fixedStocktake || !elSk) {
        S.current = S.stocktakes.find((s) => String(s.id) === String(o.stocktakeId)) ||
          (o.stocktakeId ? { id: o.stocktakeId, code: '', name: '' } : null);
        return;
      }
      const chosen = S.stocktakes.find((s) => String(s.id) === String(o.stocktakeId)) || S.stocktakes[0] || null;
      elSk.innerHTML = S.stocktakes.length
        ? S.stocktakes.map((s) => `<option value="${s.id}" ${chosen && String(chosen.id) === String(s.id) ? 'selected' : ''}>${U.esc(s.code)} — ${U.esc(s.name)}</option>`).join('')
        : '<option value="">— Không có đợt đang mở —</option>';
      S.current = chosen;
    }

    async function loadItems() {
      if (!S.current || !S.current.id) { S.items = []; return; }
      try {
        const res = await API.get(`/api/entities/stocktakes/${S.current.id}`);
        S.items = ((res.meta && res.meta.related && res.meta.related.items) || []);
        const info = res.data || {};
        S.current = Object.assign({}, S.current, { code: info.code, name: info.name });
      } catch (e) { S.items = []; }
      renderProgress();
    }

    // Nạp dữ liệu nền; doLookup chờ promise này để tránh xử lý mã trước khi có đợt kiểm kê
    const booted = (async () => { await loadStocktakes(); await loadItems(); })();

    /* --------- Hiển thị --------- */

    function renderProgress() {
      const items = S.items || [];
      const counted = items.filter((i) => i.counted).length;
      const total = items.length;
      const diff = items.filter((i) => i.counted && i.result && i.result !== 'match').length;
      const pct = total ? Math.round((counted / total) * 100) : 0;
      const s = S.session;
      const chips =
        Object.keys(S.groups.cat).map((k) => `<span class="chip">${U.esc(k)}: <b>${S.groups.cat[k]}</b></span>`).join('') +
        Object.keys(S.groups.dept).map((k) => `<span class="chip muted-chip">${U.esc(k)}: <b>${S.groups.dept[k]}</b></span>`).join('');
      $('#sd-progress').innerHTML = `
        <div class="scan-progress" style="margin-top:10px">
          <div class="scan-bar"><span style="width:${pct}%"></span></div>
          <div class="scan-nums">
            <span><b>${counted}</b>/${total} đã kiểm kê</span>
            <span class="ok"><b>${counted - diff}</b> khớp</span>
            <span class="warn"><b>${diff}</b> chênh</span>
          </div>
          <div class="scan-session tiny muted">Phiên này: <b>${s.counted}</b> lượt ghi nhận • <b>${s.duplicates}</b> lượt trùng</div>
          ${chips ? `<div class="scan-chips">${chips}</div>` : ''}
        </div>`;
    }

    function renderNotFound(suggestions) {
      elResult.innerHTML = `
        <div class="scan-banner danger">⚠️ Không tìm thấy tài sản với mã đã quét</div>
        ${(suggestions && suggestions.length) ? `<div class="scan-actions-row">${suggestions.map((s) => `<button class="chip" data-sug="${U.attr(s.code)}">${U.esc(s.code)} — ${U.esc(String(s.name || '').slice(0, 30))}</button>`).join('')}</div>` : ''}`;
      elResult.querySelectorAll('[data-sug]').forEach((b) => { b.onclick = () => doLookup(b.dataset.sug, { force: true }); });
    }

    function renderAsset(d) {
      const asset = d.asset;
      const item = d.item;
      const dup = d.alreadyCounted
        ? '<div class="scan-banner warn flash">🔁 Cảnh báo quét trùng — tài sản này đã được kiểm kê. Quét lại sẽ cập nhật kết quả.</div>'
        : d.inStocktakeList
          ? '<div class="scan-banner ok">✅ Tài sản có trong danh sách kiểm kê.</div>'
          : '<div class="scan-banner warn">➕ Chưa có trong danh sách — ghi nhận sẽ đánh dấu <b>phát hiện thêm</b>.</div>';
      elResult.innerHTML = `
        ${dup}
        ${assetBlock(asset)}
        <div class="scan-result-actions">
          <button class="btn primary" data-act="match">✅ Khớp sổ sách</button>
          <button class="btn" data-act="wrong_location">📍 Sai vị trí</button>
          <button class="btn" data-act="damaged">🛠 Hư hỏng</button>
          <button class="btn danger" data-act="missing">❌ Không tìm thấy</button>
        </div>`;
      elResult.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => record(asset, b.dataset.act); });
    }

    function renderRecorded(asset, item) {
      const warn = item.result && item.result !== 'match';
      elResult.innerHTML = `
        <div class="scan-banner ${warn ? 'warn' : 'ok'}">${warn ? '⚠️' : '✅'} Đã ghi nhận <span class="mono">${U.esc(asset.code)}</span> — <b>${RESULT_LABELS[item.result] || item.result}</b></div>
        <div class="scan-actions-row">
          <span class="muted tiny">Đổi kết quả:</span>
          <button class="btn ghost" data-act="match">✅ Khớp</button>
          <button class="btn ghost" data-act="wrong_location">📍 Sai vị trí</button>
          <button class="btn ghost" data-act="damaged">🛠 Hư hỏng</button>
          <button class="btn ghost" data-act="missing">❌ Không tìm thấy</button>
        </div>
        <div class="scan-actions-row">
          <button class="btn ghost" data-undo="${item.id}">↩ Hoàn tác</button>
          <button class="btn" id="sd-next">➡ Quét tiếp</button>
        </div>`;
      elResult.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => record(asset, b.dataset.act); });
      elResult.querySelector('[data-undo]').onclick = () => undo(item.id);
      $('#sd-next').onclick = () => { elInput.value = ''; elInput.focus(); };
    }

    function renderError(message) {
      elResult.innerHTML = `<div class="scan-banner danger">⚠️ ${U.esc(message)}</div>`;
    }

    /* --------- Quét & ghi nhận --------- */

    async function doLookup(raw, opts) {
      const o2 = opts || {};
      const value = String(raw || '').trim();
      if (!value) return;
      const now = Date.now();
      if (!o2.force && value === S.lastCode && now - S.lastAt < 1500) return;
      S.lastCode = value; S.lastAt = now;
      if (S.busy || S.closed) return;
      await booted; // chờ nạp xong đợt kiểm kê (hộp thoại mở ngay lập tức, dữ liệu nạp nền)
      if (S.closed) return;
      if (!S.current) { UI.toast('Chưa có đợt kiểm kê', 'Hãy chọn hoặc tạo một đợt kiểm kê đang mở', 'warning'); return; }
      S.busy = true;
      S.session.scans++;
      try {
        const res = await API.get('/api/scan/lookup?code=' + encodeURIComponent(value) + '&stocktakeId=' + S.current.id);
        const d = res.data || {};
        if (!d.asset) {
          renderNotFound(d.suggestions);
          feedback('error', 'Mã ' + value + ' không có trong hệ thống');
          return;
        }
        if (d.alreadyCounted) {
          S.session.duplicates++;
          feedback('warn', 'Quét trùng: ' + d.asset.code + ' đã kiểm kê' + (d.countedByName ? ' bởi ' + d.countedByName : ''));
        }
        renderAsset(d);
        setStatus(`Đã đọc <b class="mono">${U.esc(d.asset.code)}</b> — ${d.alreadyCounted ? '⚠️ đã kiểm kê trước' : 'chưa kiểm kê'}.`, d.alreadyCounted ? 'warn' : 'ok');
        if (S.autoCount) await record(d.asset, 'match');
      } catch (e) {
        renderError(e.message || 'Lỗi tra cứu mã');
        feedback('error', e.message || 'Lỗi tra cứu');
      } finally {
        S.busy = false;
        renderProgress();
      }
    }

    async function record(asset, result) {
      if (!S.current || !S.current.id) return;
      try {
        const res = await API.post('/api/scan/count', { stocktakeId: S.current.id, code: asset.code, result });
        const d = res.data || {};
        const item = d.item || {};
        S.session.counted++;
        if (asset.categoryName) S.groups.cat[asset.categoryName] = (S.groups.cat[asset.categoryName] || 0) + 1;
        if (asset.departmentName) S.groups.dept[asset.departmentName] = (S.groups.dept[asset.departmentName] || 0) + 1;
        // Cập nhật danh sách cục bộ (tiến độ phản ánh ngay)
        const local = S.items.find((i) => String(i.assetId) === String(asset.id));
        if (local) Object.assign(local, { counted: true, result: item.result || result, countedAt: item.countedAt, countedQty: item.countedQty, countedByName: item.countedByName });
        else S.items.push({ id: item.id, assetId: asset.id, assetCode: asset.code, assetName: asset.name, counted: true, result: item.result || result, countedAt: item.countedAt, countedQty: item.countedQty });
        renderRecorded(d.asset || asset, item);
        renderProgress();
        feedback(result === 'match' ? 'ok' : 'warn', `${asset.code} — ${RESULT_LABELS[result] || result}`);
        if (typeof o.onRecord === 'function') {
          try { o.onRecord(item, d.asset || asset, d); } catch (e) { /* lỗi phía trang gọi */ }
        }
      } catch (e) {
        renderError(e.message || 'Lỗi ghi nhận kiểm kê');
        feedback('error', e.message || 'Lỗi ghi nhận');
      }
    }

    async function undo(itemId) {
      const yes = await UI.confirm({
        title: 'Hoàn tác lượt kiểm kê',
        message: 'Bỏ đánh dấu “đã kiểm kê” cho dòng này?',
        confirmText: 'Hoàn tác', danger: true,
      });
      if (!yes) return;
      try {
        await API.post(`/api/stocktakes/${S.current.id}/items/${itemId}`, { counted: false });
        const local = S.items.find((i) => String(i.id) === String(itemId));
        if (local) { local.counted = false; local.countedQty = null; local.countedAt = null; }
        renderProgress();
        elResult.innerHTML = '<div class="scan-banner ok">↩ Đã hoàn tác — tài sản trở về trạng thái chưa kiểm kê.</div>';
        UI.toast('Đã hoàn tác', '', 'success');
        if (typeof o.onRecord === 'function') {
          try { o.onRecord({ id: itemId, counted: false }, { id: local ? local.assetId : null }, { undone: true }); } catch (e) { /* bỏ qua */ }
        }
      } catch (e) { UI.toast('Không hoàn tác được', e.message, 'danger'); }
    }

    /* --------- Camera & nhập tay --------- */

    S.scanner = makeScanner({ stream: null, detector: null, timer: null, scanning: false }, video, {
      onCode: (value, format) => {
        setStatus(`Đã quét: <b class="mono">${U.esc(parseScanValue(value).code || value)}</b> (${format || 'mã'})`);
        doLookup(value, { from: 'camera' });
      },
      onStatus: (text, kind) => {
        setStatus(text, kind);
        if (kind === 'ok') {
          elPlaceholder.style.display = 'none';
          btnStart.hidden = true;
          btnStop.hidden = false;
        }
      },
    });

    $('#sd-start').onclick = async () => {
      const okk = await S.scanner.start();
      if (!okk) UI.toast('Không mở được camera', 'Trình duyệt chặn camera hoặc trang không chạy trên HTTPS/localhost. Bạn vẫn có thể nhập mã thủ công.', 'warning');
    };
    $('#sd-stop').onclick = () => {
      S.scanner.stop();
      elPlaceholder.style.display = '';
      btnStart.hidden = false;
      btnStop.hidden = true;
      setStatus('Camera đã tắt.');
    };
    $('#sd-file').onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!window.BarcodeDetector) { UI.toast('Không đọc được ảnh', 'Trình duyệt không hỗ trợ BarcodeDetector. Hãy nhập mã tài sản in trên tem.', 'warning'); return; }
      try {
        const value = await S.scanner.decodeFile(file);
        if (!value) { UI.toast('Không thấy mã trong ảnh', 'Hãy chụp gần hơn, đủ sáng và lấy trọn mã QR/mã vạch', 'warning'); return; }
        doLookup(value, { from: 'image', force: true });
      } catch (err) { UI.toast('Không đọc được ảnh', err.message || 'Lỗi xử lý ảnh', 'danger'); }
    };
    $('#sd-demo').onclick = () => {
      const next = S.items.find((i) => !i.counted);
      if (!next) { UI.toast('Đã kiểm kê hết', 'Mọi tài sản trong đợt đều đã được kiểm kê', 'success'); return; }
      elInput.value = next.assetCode;
      doLookup(next.assetCode, { from: 'demo', force: true });
    };
    $('#sd-go').onclick = () => doLookup(elInput.value, { from: 'manual', force: true });
    elInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doLookup(elInput.value, { from: 'manual', force: true }); }
    });
    const elAuto = $('#sd-auto');
    if (elAuto) elAuto.onchange = () => { S.autoCount = elAuto.checked; };
    const elSound = $('#sd-sound');
    if (elSound) elSound.onchange = () => { S.sound = elSound.checked; };
    if (elSk) {
      elSk.onchange = async () => {
        S.current = S.stocktakes.find((s) => String(s.id) === elSk.value) || null;
        S.session = { scans: 0, counted: 0, duplicates: 0 };
        S.groups = { cat: {}, dept: {} };
        await loadItems();
      };
    }
    // Kéo–thả ảnh chứa mã
    const stage = $('#sd-stage');
    ['dragover', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => e.preventDefault()));
    stage.addEventListener('drop', async (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && window.BarcodeDetector) {
        try { const v = await S.scanner.decodeFile(f); if (v) doLookup(v, { from: 'image', force: true }); } catch (err) { /* bỏ qua */ }
      }
    });

    /* --------- Khởi động --------- */
    await booted;
    if (!window.BarcodeDetector) {
      setStatus('Trình duyệt không có bộ đọc mã tự động — dùng ô nhập mã, <b>Đọc từ ảnh</b> (nếu có) hoặc <b>Quét thử</b>.', 'warn');
    }
    setTimeout(() => { if (elInput && !S.closed) elInput.focus(); }, 120);
  };

  /* ============================== QUÉT ĐỂ TÌM TÀI SẢN ============================== */

  /**
   * Quét mã (camera / nhập tay) ở bất kỳ đâu — quét được là mở thẳng hồ sơ tài sản.
   * Dùng cho nút quét ở thanh trên cùng và danh sách tài sản.
   */
  Pages.scanAssetDialog = function (opts) {
    const o = Object.assign({ title: '📷 Quét mã tìm tài sản' }, opts || {});
    const S = {
      scanner: null,
      busy: false,
      lastCode: '',
      lastAt: 0,
      closed: false,
      sound: true,
      demoCode: '',
      navTimer: null,
    };

    const body = `
      <div class="sd-top">
        <span class="muted tiny">Quét xong hệ thống <b>tự mở hồ sơ tài sản</b> tương ứng. Hỗ trợ mã tài sản, số sê-ri, liên kết tem <span class="mono">ams://asset/…</span>.</span>
        <div class="spacer" style="flex:1"></div>
        <label class="scan-field scan-toggle"><input type="checkbox" id="sa-sound" checked/><span>Âm thanh</span></label>
      </div>
      <div class="sd-grid">
        <div>
          <div class="scan-stage" id="sa-stage">
            <video id="sa-video" playsinline muted autoplay></video>
            <div class="scan-overlay"><div class="scan-frame"><span class="scan-corner tl"></span><span class="scan-corner tr"></span><span class="scan-corner bl"></span><span class="scan-corner br"></span><div class="scan-laser"></div></div></div>
            <div class="scan-placeholder" id="sa-placeholder">📷<div>Camera đang tắt</div></div>
          </div>
          <div class="scan-actions">
            <button class="btn primary" id="sa-start">▶ Bật camera</button>
            <button class="btn" id="sa-stop" hidden>⏸ Tắt</button>
            <button class="btn ghost" id="sa-demo">🧪 Quét thử</button>
          </div>
          <div class="scan-status tiny" id="sa-status">Sẵn sàng. Bật camera hoặc nhập mã tài sản rồi Enter.</div>
          <div class="scan-manual">
            <input type="text" id="sa-input" placeholder="Nhập / dán mã tài sản rồi Enter…" autocomplete="off"/>
            <button class="btn primary" id="sa-go">Tìm</button>
          </div>
        </div>
        <div class="sd-side">
          <div class="card" style="padding:12px">
            <div class="scan-result" id="sa-result">
              <div class="scan-idle">🔍<div><b>Chưa quét</b></div><div class="muted tiny">Kết quả tra cứu hiện ở đây.</div></div>
            </div>
          </div>
        </div>
      </div>`;

    const m = UI.modal({
      size: 'lg',
      title: o.title,
      subtitle: 'Quét mã QR/mã vạch trên tem tài sản — mở thẳng hồ sơ',
      body,
      footer: [{ label: '✕ Đóng', cls: 'ghost', onClick: (mm) => mm.close() }],
      closeOnOverlay: false,
      onClose: () => {
        S.closed = true;
        if (S.scanner) S.scanner.stop();
        if (S.navTimer) { clearTimeout(S.navTimer); S.navTimer = null; }
      },
    });

    const $ = (sel) => m.body.querySelector(sel);
    const elInput = $('#sa-input');
    const elStatus = $('#sa-status');
    const elResult = $('#sa-result');
    const video = $('#sa-video');
    const elPlaceholder = $('#sa-placeholder');
    const btnStart = $('#sa-start');
    const btnStop = $('#sa-stop');

    function setStatus(text, kind) {
      elStatus.className = 'scan-status tiny' + (kind ? ' ' + kind : '');
      elStatus.innerHTML = text;
    }

    function openAsset(asset) {
      if (S.sound) beep('ok');
      vibrate(40);
      elResult.innerHTML = `
        <div class="scan-banner ok">✅ Đã tìm thấy <span class="mono">${U.esc(asset.code)}</span> — ${U.esc(asset.name)}</div>
        <div class="muted tiny">Đang mở hồ sơ tài sản…</div>`;
      setStatus(`Mở hồ sơ <b class="mono">${U.esc(asset.code)}</b>…`, 'ok');
      S.navTimer = setTimeout(() => {
        if (S.closed) return;
        m.close();
        App.Router.navigate('/assets/' + asset.id);
      }, 550);
    }

    async function doLookup(raw, opts) {
      const o2 = opts || {};
      const value = String(raw || '').trim();
      if (!value) return;
      const now = Date.now();
      if (!o2.force && value === S.lastCode && now - S.lastAt < 2000) return;
      S.lastCode = value; S.lastAt = now;
      if (S.busy || S.closed) return;
      S.busy = true;
      try {
        const res = await API.get('/api/scan/lookup?code=' + encodeURIComponent(value));
        const d = res.data || {};
        if (!d.asset) {
          elResult.innerHTML = `
            <div class="scan-banner danger">⚠️ Không tìm thấy tài sản với mã <span class="mono">${U.esc(value)}</span></div>
            ${(d.suggestions && d.suggestions.length) ? `<div class="scan-actions-row">${d.suggestions.map((s) => `<button class="chip" data-open="${s.id}">${U.esc(s.code)} — ${U.esc(String(s.name || '').slice(0, 30))}</button>`).join('')}</div>` : ''}
            <div class="muted tiny">Kiểm tra lại mã in trên tem, hoặc tạo tài sản mới.</div>`;
          elResult.querySelectorAll('[data-open]').forEach((b) => {
            b.onclick = () => {
              const a = (d.suggestions || []).find((x) => String(x.id) === String(b.dataset.open));
              if (a) openAsset(a);
            };
          });
          if (S.sound) beep('error');
          vibrate([90, 60, 90]);
          return;
        }
        openAsset(d.asset);
      } catch (e) {
        elResult.innerHTML = `<div class="scan-banner danger">⚠️ ${U.esc(e.message || 'Lỗi tra cứu')}</div>`;
      } finally {
        S.busy = false;
      }
    }

    S.scanner = makeScanner({ stream: null, detector: null, timer: null, scanning: false }, video, {
      onCode: (value, format) => {
        setStatus(`Đã quét: <b class="mono">${U.esc(parseScanValue(value).code || value)}</b> (${format || 'mã'})`);
        doLookup(value, { from: 'camera' });
      },
      onStatus: (text, kind) => {
        setStatus(text, kind);
        if (kind === 'ok') {
          elPlaceholder.style.display = 'none';
          btnStart.hidden = true;
          btnStop.hidden = false;
        }
      },
    });

    $('#sa-start').onclick = async () => {
      const okk = await S.scanner.start();
      if (!okk) UI.toast('Không mở được camera', 'Trình duyệt chặn camera hoặc trang không chạy trên HTTPS/localhost. Bạn vẫn có thể nhập mã thủ công.', 'warning');
    };
    $('#sa-stop').onclick = () => {
      S.scanner.stop();
      elPlaceholder.style.display = '';
      btnStart.hidden = false;
      btnStop.hidden = true;
      setStatus('Camera đã tắt.');
    };
    $('#sa-demo').onclick = async () => {
      if (S.demoCode) { doLookup(S.demoCode, { force: true }); return; }
      try {
        const res = await API.get('/api/entities/assets?limit=1&sort=id&order=desc');
        const a = (res.data || [])[0];
        if (!a) { UI.toast('Chưa có tài sản', 'Hệ thống chưa có tài sản nào để quét thử', 'warning'); return; }
        S.demoCode = a.code;
        elInput.value = a.code;
        doLookup(a.code, { from: 'demo', force: true });
      } catch (e) { UI.toast('Lỗi', e.message, 'error'); }
    };
    $('#sa-go').onclick = () => doLookup(elInput.value, { from: 'manual', force: true });
    elInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doLookup(elInput.value, { from: 'manual', force: true }); }
    });
    const elSound = $('#sa-sound');
    if (elSound) elSound.onchange = () => { S.sound = elSound.checked; };

    setTimeout(() => { if (elInput && !S.closed) elInput.focus(); }, 120);
  };
})();
