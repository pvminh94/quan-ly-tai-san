'use strict';
/**
 * documents.js — Sinh chứng từ in phía server (HTML chuẩn in ấn A4)
 * Gồm: biên bản bàn giao, phiếu điều chuyển, phiếu bảo trì, biên bản thanh lý,
 *       biên bản kiểm kê, phiếu bảo hành, bảng khấu hao, nhãn dán (label).
 */

const store = require('./store');
const service = require('./service');
const util = require('./util');
const reportEngine = require('./report-engine');
const digisig = require('./digisig');
const qr = require('./qr');
const formatValue = reportEngine.formatValue;

const esc = util.escapeHtml;

function money(v) {
  return formatValue(v, 'money', 0, { currencySymbol: ' VNĐ', digits: 0 });
}

function date(v) {
  return formatValue(v, 'date');
}

function formatDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function header(cfg, title, code, dateStr) {
  const c = cfg.company;
  return `
  <div class="doc-head">
    <div class="left">
      <div class="company">${esc(c.name)}</div>
      <div class="muted">Địa chỉ: ${esc(c.address)}</div>
      <div class="muted">Điện thoại: ${esc(c.phone)} • MST: ${esc(c.taxCode)}</div>
    </div>
    <div class="right">
      <div class="muted">Mẫu số: ${esc(code)}</div>
      <div class="muted">Ngày in: ${date(new Date().toISOString())}</div>
    </div>
  </div>
  <h1 class="doc-title">${esc(title)}</h1>
  ${dateStr ? `<div class="doc-sub">Ngày ${date(dateStr)}</div>` : ''}`;
}

function signatures(cfg, labels, people, meta) {
  let docSignatures = [];
  if (meta && meta.docType && meta.docId) {
    try {
      docSignatures = store.filter(
        'signatures',
        (s) => s.docType === meta.docType && String(s.docId) === String(meta.docId) && s.status === 'valid'
      );
    } catch (e) {
      docSignatures = [];
    }
  }

  const items = labels.map((l, i) => {
    const roleKey = (meta && meta.roles && meta.roles[i]) || '';
    const sig = docSignatures.find(
      (s) =>
        (roleKey && s.role === roleKey) ||
        (s.roleLabel && s.roleLabel === l) ||
        (s.signerTitle && s.signerTitle.toLowerCase().includes(l.toLowerCase()))
    );

    if (sig) {
      const dt = formatDateTime(sig.signedAt);
      return `<div class="sig sig-signed">
        <div class="sig-title">${esc(l)}</div>
        <div class="digital-stamp">
          ${sig.handwrittenSvg ? `<div class="stamp-handwritten">${sig.handwrittenSvg}</div>` : ''}
          <div class="stamp-box">
            <div class="stamp-head">
              <span class="stamp-ok">✓</span>
              <span class="stamp-badge">KÝ SỐ ĐIỆN TỬ</span>
            </div>
            <div class="stamp-body">
              <div><b>Ký bởi:</b> ${esc(sig.signerName)}</div>
              <div><b>Chức vụ:</b> ${esc(sig.signerTitle || 'Người ký')}</div>
              <div><b>Đơn vị:</b> ${esc(sig.orgName || (cfg && cfg.company && cfg.company.name) || '')}</div>
              <div><b>Ngày ký:</b> ${esc(dt)}</div>
              <div class="stamp-code"><b>Mã tra cứu:</b> <span class="mono">${esc(sig.code)}</span></div>
            </div>
          </div>
        </div>
        <div class="sig-name">${esc(sig.signerName)}</div>
      </div>`;
    }

    return `<div class="sig"><div class="sig-title">${esc(l)}</div><div class="sig-hint">(Ký, họ tên)</div><div class="sig-name">${esc((people && people[i]) || '')}</div></div>`;
  });
  return `<div class="signatures">${items.join('')}</div>`;
}

function infoTable(rows) {
  return `<table class="info"><tbody>${rows
    .filter(Boolean)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`)
    .join('')}</tbody></table>`;
}

function wrap(cfg, title, body, opts) {
  const o = opts || {};
  let docSignatures = [];
  if (o.docType && o.docId) {
    try {
      docSignatures = store.filter(
        'signatures',
        (s) => s.docType === o.docType && String(s.docId) === String(o.docId) && s.status === 'valid'
      );
    } catch (e) {
      docSignatures = [];
    }
  }

  // Khung xác thực điện tử ở chân chứng từ nếu đã có chữ ký số
  let verifBlock = '';
  if (docSignatures.length > 0) {
    const primary = docSignatures[0];
    const verifUrl = '/api/documents/verify?code=' + encodeURIComponent(primary.code);
    const qrSvg = qr.svg(verifUrl, { module: 2, quiet: 1 });
    verifBlock = `
    <div class="doc-verif-card">
      <div class="doc-verif-qr">${qrSvg}</div>
      <div class="doc-verif-info">
        <div class="doc-verif-title">🛡️ CHỨNG TỪ ĐIỆN TỬ ĐÃ KÝ SỐ — NGHỊ ĐỊNH 130/2018/NĐ-CP &amp; LUẬT GIAO DỊCH ĐIỆN TỬ</div>
        <div class="doc-verif-text">Văn bản này đã được ký số an toàn bằng thuật toán mã hóa <b>RSA 2048-bit + SHA-256</b>. Quét mã QR hoặc truy cập hệ thống để tra cứu xác thực với mã số: <strong class="mono" style="color:#1e3a8a">${esc(docSignatures.map((s) => s.code).join(', '))}</strong></div>
        <div class="doc-verif-meta">Mã băm SHA-256: <span class="mono">${esc(primary.contentHash.substring(0, 32))}…</span> • Ngày ký: ${formatDateTime(primary.signedAt)} • Đơn vị CA: ${esc(primary.certificate.issuer || 'AMS Enterprise CA')}</div>
      </div>
    </div>`;
  }

  // multiSheet: body tự chứa các div .sheet (cho trang tem nhiều trang)
  const sheets = o.multiSheet ? body : '<div class="sheet">' + body + verifBlock + '</div>';

  const rolesJson = JSON.stringify(o.roles || (o.docType ? digisig.getRolesForDoc(o.docType) : []));

  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", "Inter", serif; font-size: 13pt; color:#0f172a; margin:0; background:#e2e8f0; }
  .toolbar { position:fixed; inset:0 0 auto 0; height:46px; background:#0f172a; color:#fff; display:flex; align-items:center; gap:10px; padding:0 16px; font-family:"Inter",Arial,sans-serif; font-size:13px; z-index:9; }
  .toolbar button, .toolbar a { background:#2563eb; color:#fff; border:0; padding:7px 14px; border-radius:6px; cursor:pointer; text-decoration:none; font-size:13px; }
  .toolbar a.secondary { background:#334155; }
  .sheet { width:210mm; min-height:297mm; padding:18mm 16mm; background:#fff; margin:16px auto; box-shadow:0 2px 12px rgba(15,23,42,.2); position:relative; }
  .doc-head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1e3a8a; padding-bottom:8px; }
  .company { font-weight:700; font-size:13pt; color:#1e3a8a; text-transform:uppercase; }
  .muted { color:#475569; font-size:10pt; font-family:"Inter",Arial,sans-serif; }
  .doc-title { text-align:center; font-size:20pt; margin:18px 0 4px; text-transform:uppercase; letter-spacing:.5px; }
  .doc-sub { text-align:center; font-style:italic; margin-bottom:16px; font-size:11pt; }
  table { width:100%; border-collapse:collapse; }
  table.info { margin:10px 0 16px; font-family:"Inter",Arial,sans-serif; font-size:10.5pt; }
  table.info th { width:34%; text-align:left; padding:6px 8px; background:#f1f5f9; border:1px solid #cbd5e1; font-weight:600; }
  table.info td { padding:6px 8px; border:1px solid #cbd5e1; }
  table.data { font-family:"Inter",Arial,sans-serif; font-size:10pt; margin:12px 0; }
  table.data th { background:#dbeafe; border:1px solid #94a3b8; padding:6px 8px; text-align:center; }
  table.data td { border:1px solid #cbd5e1; padding:6px 8px; vertical-align:top; }
  table.data td.num { text-align:right; }
  table.data td.ctr { text-align:center; }
  table.data tfoot td { font-weight:700; background:#f8fafc; }
  .section { margin:18px 0 8px; font-weight:700; font-size:11pt; font-family:"Inter",Arial,sans-serif; text-transform:uppercase; color:#1e293b; border-left:4px solid #2563eb; padding-left:8px; }
  .signatures { display:flex; gap:12px; margin-top:36px; text-align:center; font-family:"Inter",Arial,sans-serif; }
  .sig { flex:1; min-width:0; }
  .sig-title { font-weight:700; font-size:10.5pt; }
  .sig-hint { font-style:italic; font-size:9pt; color:#64748b; margin-bottom:64px; }
  .sig-name { font-size:10.5pt; border-top:1px dashed #94a3b8; padding-top:4px; }
  .note { font-family:"Inter",Arial,sans-serif; font-size:10pt; color:#334155; }
  .label-sheet { padding:10mm 12mm; page-break-after:always; }
  .label-sheet:last-of-type { page-break-after:auto; }

  /* Dấu chữ ký số điện tử chuẩn */
  .sig-signed { display: flex; flex-direction: column; align-items: center; }
  .digital-stamp { margin: 6px auto; max-width: 220px; width: 100%; }
  .stamp-box { border: 1.5px solid #16a34a; border-radius: 6px; padding: 5px 8px; background: #f0fdf4; color: #166534; font-size: 8.5pt; text-align: left; }
  .stamp-head { display: flex; align-items: center; gap: 4px; font-weight: 700; color: #15803d; font-size: 8.5pt; border-bottom: 1px dashed #86efac; padding-bottom: 3px; margin-bottom: 3px; }
  .stamp-ok { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; background: #16a34a; color: #fff; border-radius: 50%; font-size: 10px; font-weight: bold; }
  .stamp-body div { margin-top: 2px; line-height: 1.25; }
  .stamp-code { font-size: 8pt; color: #14532d; }
  .stamp-handwritten { max-height: 48px; margin-bottom: -2px; display: flex; justify-content: center; }
  .stamp-handwritten svg { max-height: 48px; width: auto; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 9pt; }

  /* Khung xác thực chân chứng từ */
  .doc-verif-card { margin-top: 28px; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; display: flex; align-items: center; gap: 14px; font-family: "Inter", Arial, sans-serif; }
  .doc-verif-qr { width: 56px; height: 56px; flex-shrink: 0; }
  .doc-verif-qr svg { width: 100%; height: 100%; display: block; }
  .doc-verif-info { flex: 1; min-width: 0; }
  .doc-verif-title { font-size: 8.5pt; font-weight: 700; color: #1e3a8a; margin-bottom: 2px; }
  .doc-verif-text { font-size: 8pt; color: #475569; line-height: 1.35; }
  .doc-verif-meta { font-size: 7.5pt; color: #64748b; margin-top: 3px; }

  /* Hộp thoại ký số trên trang */
  .sig-modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(15,23,42,.6); z-index: 99; align-items: center; justify-content: center; font-family: "Inter", Arial, sans-serif; }
  .sig-modal { background: #fff; width: 440px; max-width: 95vw; border-radius: 12px; box-shadow: 0 20px 40px rgba(0,0,0,.3); overflow: hidden; }
  .sig-modal-head { padding: 14px 18px; background: #1e3a8a; color: #fff; display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 14px; }
  .sig-modal-body { padding: 16px 18px; font-size: 13px; color: #1e293b; max-height: 80vh; overflow-y: auto; }
  .sig-modal-foot { padding: 12px 18px; background: #f1f5f9; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid #e2e8f0; }
  .sig-form-row { margin-bottom: 12px; }
  .sig-form-row label { display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #475569; }
  .sig-form-row input, .sig-form-row select { width: 100%; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-family: inherit; }
  .sig-pad-box { border: 1px dashed #94a3b8; border-radius: 6px; background: #f8fafc; text-align: center; position: relative; }
  .sig-pad-box canvas { display: block; width: 100%; height: 110px; touch-action: none; cursor: crosshair; }
  .sig-pad-bar { padding: 4px 8px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; }
  .sig-pad-clear { background: none; border: 0; color: #dc2626; cursor: pointer; font-size: 11px; padding: 2px 6px; }

  @media print {
    body { background:#fff; }
    .toolbar, .sig-modal-backdrop { display:none !important; }
    .sheet { margin:0; box-shadow:none; width:auto; min-height:auto; padding:0; }
    .doc-verif-card { border:1px solid #94a3b8; background:#fff; }
    .stamp-box { background:#fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size:A4 portrait; margin:14mm 14mm; }
  }
</style></head>
<body>
<div class="toolbar">
  <strong>${esc(title)}</strong>
  <div style="flex:1"></div>
  ${o.docType && o.docId ? `<button type="button" onclick="openSignModal()" style="background:#16a34a;font-weight:600">✍️ Ký số chứng từ</button>` : ''}
  ${o.docType && o.docId ? `<button type="button" onclick="openVerifyModal()" style="background:#0891b2">🔍 Xác thực chữ ký</button>` : ''}
  <button onclick="window.print()">🖨 In / Lưu PDF</button>
  <a class="secondary" href="javascript:window.close()">Đóng</a>
</div>
${sheets}

${o.docType && o.docId ? `
<!-- Modal Ký số trực tiếp trên chứng từ -->
<div class="sig-modal-backdrop" id="sig-modal-wrap">
  <div class="sig-modal">
    <div class="sig-modal-head">
      <span>✍️ Ký số chứng từ điện tử</span>
      <button type="button" onclick="closeSignModal()" style="background:none;border:0;color:#fff;font-size:18px;cursor:pointer">✕</button>
    </div>
    <form id="sig-form" onsubmit="submitSignature(event)">
      <div class="sig-modal-body">
        <div class="sig-form-row">
          <label>Vai trò người ký</label>
          <select id="sig-role" required></select>
        </div>
        <div class="sig-form-row">
          <label>Họ và tên người ký</label>
          <input type="text" id="sig-name" placeholder="Nguyễn Văn Minh" required/>
        </div>
        <div class="sig-form-row">
          <label>Chức vụ / Chức danh</label>
          <input type="text" id="sig-title" placeholder="Kế toán trưởng / Đại diện bên giao" required/>
        </div>
        <div class="sig-form-row">
          <label>Phương thức ký</label>
          <div style="display:flex;gap:12px;margin:6px 0">
            <label style="font-weight:normal;display:inline-flex;align-items:center;gap:4px">
              <input type="radio" name="sig-type" value="cert" checked onchange="toggleSigCanvas(false)"/> Con dấu số điện tử (CA)
            </label>
            <label style="font-weight:normal;display:inline-flex;align-items:center;gap:4px">
              <input type="radio" name="sig-type" value="hand" onchange="toggleSigCanvas(true)"/> Chữ ký tay cảm ứng
            </label>
          </div>
        </div>
        <div class="sig-form-row" id="canvas-row" style="display:none">
          <label>Vẽ chữ ký (chuột hoặc ngón tay trên điện thoại)</label>
          <div class="sig-pad-box">
            <canvas id="sig-canvas" width="400" height="110"></canvas>
            <div class="sig-pad-bar">
              <span>Chạm / kéo để vẽ chữ ký</span>
              <button type="button" class="sig-pad-clear" onclick="clearCanvas()">Xóa vẽ lại</button>
            </div>
          </div>
        </div>
        <div class="sig-form-row">
          <label>Mã PIN ký số bảo mật</label>
          <input type="password" id="sig-pin" placeholder="Mã PIN (mặc định: 123456)"/>
          <small style="color:#64748b;font-size:11px">Dùng PIN để xác nhận thẩm quyền ký số theo tiêu chuẩn PKI.</small>
        </div>
      </div>
      <div class="sig-modal-foot">
        <button type="button" class="secondary" onclick="closeSignModal()">Hủy</button>
        <button type="submit" style="background:#16a34a;font-weight:600">✍️ Ký &amp; Đóng dấu điện tử</button>
      </div>
    </form>
  </div>
</div>

<script>
(function() {
  const DOC_TYPE = ${JSON.stringify(o.docType)};
  const DOC_ID = ${JSON.stringify(String(o.docId))};
  const ROLES = ${rolesJson};

  const modal = document.getElementById('sig-modal-wrap');
  const roleSelect = document.getElementById('sig-role');
  const canvas = document.getElementById('sig-canvas');
  let ctx2d = null;
  let drawing = false;
  let hasStrokes = false;

  ROLES.forEach(function(r) {
    const opt = document.createElement('option');
    opt.value = r.key;
    opt.textContent = r.label;
    opt.dataset.defaultTitle = r.defaultTitle || '';
    roleSelect.appendChild(opt);
  });

  roleSelect.onchange = function() {
    const opt = roleSelect.options[roleSelect.selectedIndex];
    if (opt && opt.dataset.defaultTitle && !document.getElementById('sig-title').value) {
      document.getElementById('sig-title').value = opt.dataset.defaultTitle;
    }
  };
  if (roleSelect.options.length) roleSelect.onchange();

  window.openSignModal = function() {
    modal.style.display = 'flex';
    initCanvas();
  };

  window.closeSignModal = function() {
    modal.style.display = 'none';
  };

  window.toggleSigCanvas = function(show) {
    document.getElementById('canvas-row').style.display = show ? 'block' : 'none';
    if (show) initCanvas();
  };

  function initCanvas() {
    if (!canvas || ctx2d) return;
    ctx2d = canvas.getContext('2d');
    ctx2d.lineWidth = 2.5;
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';
    ctx2d.strokeStyle = '#1e3a8a';

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height)
      };
    }

    function start(e) {
      drawing = true;
      hasStrokes = true;
      const p = getPos(e);
      ctx2d.beginPath();
      ctx2d.moveTo(p.x, p.y);
      if (e.cancelable) e.preventDefault();
    }
    function move(e) {
      if (!drawing) return;
      const p = getPos(e);
      ctx2d.lineTo(p.x, p.y);
      ctx2d.stroke();
      if (e.cancelable) e.preventDefault();
    }
    function stop() { drawing = false; }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', stop);
  }

  window.clearCanvas = function() {
    if (!ctx2d || !canvas) return;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokes = false;
  };

  function canvasToSvg() {
    if (!hasStrokes || !canvas) return null;
    const dataUrl = canvas.toDataURL('image/png');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 110" width="160" height="44"><image href="' + dataUrl + '" width="400" height="110"/></svg>';
  }

  window.submitSignature = async function(e) {
    e.preventDefault();
    const roleOpt = roleSelect.options[roleSelect.selectedIndex];
    const roleKey = roleSelect.value;
    const roleLabel = roleOpt ? roleOpt.textContent : '';
    const signerName = document.getElementById('sig-name').value.trim();
    const signerTitle = document.getElementById('sig-title').value.trim();
    const pin = document.getElementById('sig-pin').value.trim();
    const handwrittenSvg = canvasToSvg();

    try {
      const res = await fetch('/api/documents/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType: DOC_TYPE,
          docId: DOC_ID,
          role: roleKey,
          roleLabel: roleLabel,
          signerName: signerName,
          signerTitle: signerTitle,
          pin: pin,
          handwrittenSvg: handwrittenSvg
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi khi ký số');
      alert('✓ Ký số chứng từ thành công! Mã xác thực: ' + data.data.code);
      window.location.reload();
    } catch (err) {
      alert('Không thể ký số: ' + err.message);
    }
  };

  window.openVerifyModal = async function() {
    try {
      const res = await fetch('/api/documents/' + DOC_TYPE + '/' + DOC_ID + '/signatures');
      const data = await res.json();
      const list = (data && data.data) || [];
      if (!list.length) {
        alert('Chứng từ này hiện chưa có chữ ký số nào được ghi nhận.');
        return;
      }
      const primary = list[0];
      window.open('/api/documents/verify?code=' + encodeURIComponent(primary.code), '_blank');
    } catch (err) {
      alert('Lỗi tra cứu: ' + err.message);
    }
  };
})();
</script>
` : ''}

${o.autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>' : ''}
</body></html>`;
}

/* ---------------------------- Chứng từ cụ thể ---------------------------- */

function assignmentDoc(id, ctx) {
  const rec = store.find('assignments', id);
  if (!rec) return null;
  const d = service.decorate('assignments', rec);
  const asset = store.find('assets', rec.assetId);
  const da = service.decorateAsset(asset);
  const isRecover = rec.type === 'recover' || rec.type === 'return';
  const title = isRecover ? 'BIÊN BẢN THU HỒI TÀI SẢN' : 'BIÊN BẢN BÀN GIAO TÀI SẢN';
  const body = `
  ${header(ctx.settings, title, '01-VT/BBBG', d.date)}
  <p class="note">Hôm nay, ngày ${date(d.date)}, tại ${esc(ctx.settings.company.name)}, chúng tôi gồm:</p>
  <table class="data">
    <thead><tr><th style="width:60px">Bên</th><th>Họ và tên</th><th>Chức vụ / Bộ phận</th><th>Đại diện</th></tr></thead>
    <tbody>
      <tr><td class="ctr">Giao</td><td>${esc(d.fromUserName || ctx.settings.company.representative)}</td><td>${esc(store.find('users', rec.fromUserId) ? (store.find('users', rec.fromUserId).position || '') : 'Bộ phận quản lý tài sản')}</td><td>Bên giao tài sản</td></tr>
      <tr><td class="ctr">Nhận</td><td>${esc(d.toUserName || '')}</td><td>${esc(d.departmentName || '')}</td><td>Bên nhận tài sản</td></tr>
    </tbody>
  </table>
  <div class="section">Nội dung bàn giao</div>
  <table class="data">
    <thead><tr><th style="width:40px">STT</th><th>Mã tài sản</th><th>Tên tài sản</th><th>Model / Serial</th><th>ĐVT</th><th>SL</th><th>Tình trạng</th><th>Nguyên giá</th></tr></thead>
    <tbody>
      <tr>
        <td class="ctr">1</td><td class="ctr">${esc(d.assetCode)}</td><td>${esc(d.assetName)}</td>
        <td>${esc(da.model || '')} ${da.serial ? '/ ' + esc(da.serial) : ''}</td>
        <td class="ctr">${esc(da.unit || '')}</td><td class="ctr">${da.quantity || 1}</td>
        <td class="ctr">${esc((['new','good','fair','poor','broken'].includes(rec.conditionAtHandover) ? { new:'Mới', good:'Tốt', fair:'Khá', poor:'Kém', broken:'Hỏng' }[rec.conditionAtHandover] : '') || '')}</td>
        <td class="num">${money(da.originalCost)}</td>
      </tr>
    </tbody>
  </table>
  ${infoTable([
    ['Phụ kiện kèm theo', esc(rec.accessories || 'Không')],
    ['Mục đích sử dụng', esc(rec.purpose || '')],
    ['Vị trí đặt tài sản', esc(service.nameOf('locations', rec.locationId) || da.locationName || '')],
    ['Thời hạn / Ngày dự kiến thu hồi', rec.expectedReturnDate ? date(rec.expectedReturnDate) : 'Không thời hạn'],
    ['Ghi chú', esc(rec.note || '')],
  ])}
  <p class="note">Hai bên đã kiểm tra, xác nhận tình trạng tài sản như trên. Biên bản được lập thành 02 (hai) bản, mỗi bên giữ 01 bản có giá trị pháp lý như nhau.</p>
  ${signatures(ctx.settings, ['Người giao tài sản', 'Người nhận tài sản', 'Trưởng bộ phận / Giám đốc'], [rec.signatureGiver || d.fromUserName, rec.signatureReceiver || d.toUserName, rec.signatureManager || ctx.settings.company.representative], { docType: 'assignment', docId: id, docCode: d.code, roles: ['giver', 'receiver', 'manager'] })}
  <div style="text-align:right;font-family:Inter,Arial;font-size:9pt;color:#64748b;margin-top:24px">Mã phiếu: ${esc(d.code)}</div>`;
  return wrap(ctx.settings, title, body, { docType: 'assignment', docId: id, docCode: d.code, roles: digisig.getRolesForDoc('assignment') });
}

function transferDoc(id, ctx) {
  const rec = store.find('transfers', id);
  if (!rec) return null;
  const d = service.decorate('transfers', rec);
  const asset = service.decorateAsset(store.find('assets', rec.assetId));
  const title = 'PHIẾU ĐIỀU CHUYỂN TÀI SẢN';
  const body = `
  ${header(ctx.settings, title, '02-VT/PDC', d.date)}
  ${infoTable([
    ['Số phiếu', `<strong>${esc(d.code)}</strong>`],
    ['Tài sản', `<strong>${esc(d.assetName)}</strong> (${esc(d.assetCode)})`],
    ['Danh mục', esc(asset.categoryName)],
    ['Nguyên giá', money(asset.originalCost)],
    ['Giá trị còn lại', money(asset.bookValue)],
  ])}
  <div class="section">Nội dung điều chuyển</div>
  <table class="data">
    <thead><tr><th>Tiêu chí</th><th>Từ (bàn giao)</th><th>Đến (tiếp nhận)</th></tr></thead>
    <tbody>
      <tr><td>Phòng ban</td><td>${esc(d.fromDepartmentName || '—')}</td><td><strong>${esc(d.toDepartmentName || '—')}</strong></td></tr>
      <tr><td>Người sử dụng</td><td>${esc(d.fromUserName || '—')}</td><td><strong>${esc(d.toUserName || '—')}</strong></td></tr>
      <tr><td>Vị trí</td><td>${esc(d.fromLocationName || '—')}</td><td><strong>${esc(d.toLocationName || '—')}</strong></td></tr>
    </tbody>
  </table>
  ${infoTable([
    ['Lý do điều chuyển', esc(rec.reason || '')],
    ['Chi phí vận chuyển', money(rec.transportCost)],
    ['Người đề nghị', esc(d.requestedByName || '')],
    ['Trạng thái', esc(({ draft:'Nháp', pending:'Chờ duyệt', approved:'Đã duyệt', completed:'Hoàn thành', rejected:'Từ chối', cancelled:'Đã huỷ' }[rec.status] || rec.status))],
  ])}
  <p class="note">Các bên có trách nhiệm bàn giao đầy đủ tài sản, phụ kiện kèm theo và cập nhật sổ theo dõi tài sản theo quy định.</p>
  ${signatures(ctx.settings, ['Người đề nghị', 'Người giao', 'Người nhận', 'Giám đốc duyệt'], [d.requestedByName, d.fromUserName, d.toUserName, d.approvedByName || ctx.settings.company.representative], { docType: 'transfer', docId: id, docCode: d.code, roles: ['requester', 'giver', 'receiver', 'approver'] })}`;
  return wrap(ctx.settings, title, body, { docType: 'transfer', docId: id, docCode: d.code, roles: digisig.getRolesForDoc('transfer') });
}

function maintenanceDoc(id, ctx) {
  const rec = store.find('maintenances', id);
  if (!rec) return null;
  const d = service.decorate('maintenances', rec);
  const asset = service.decorateAsset(store.find('assets', rec.assetId));
  const title = 'PHIẾU YÊU CẦU BẢO TRÌ - SỬA CHỮA';
  const body = `
  ${header(ctx.settings, title, '03-VT/PBT', d.plannedDate || d.actualDate)}
  ${infoTable([
    ['Số phiếu', `<strong>${esc(d.code)}</strong>`],
    ['Tài sản', `${esc(d.assetName)} (${esc(d.assetCode)})`],
    ['Model / Serial', `${esc(asset.model || '')} / ${esc(asset.serial || '')}`],
    ['Vị trí', esc(asset.locationName)],
    ['Phòng ban quản lý', esc(asset.departmentName)],
    ['Loại bảo trì', esc(({ preventive:'Bảo trì định kỳ', corrective:'Sửa chữa khắc phục', inspection:'Kiểm tra/Hiệu chuẩn', upgrade:'Nâng cấp', calibration:'Hiệu chỉnh' }[rec.type] || ''))],
    ['Mức độ ưu tiên', esc(({ low:'Thấp', normal:'Bình thường', high:'Cao', urgent:'Khẩn cấp' }[rec.priority] || ''))],
    ['Ngày báo hỏng', rec.reportedDate ? date(rec.reportedDate) : ''],
    ['Ngày dự kiến thực hiện', rec.plannedDate ? date(rec.plannedDate) : ''],
    ['Ngày hoàn thành', rec.actualDate ? date(rec.actualDate) : 'Chưa hoàn thành'],
    ['Đơn vị thực hiện', esc(d.vendorName || 'Nội bộ')],
    ['Kỹ thuật viên', esc(rec.technician || '')],
    ['Thời gian dừng máy', (rec.downtimeHours || 0) + ' giờ'],
  ])}
  <div class="section">Mô tả hiện trạng &amp; phương án xử lý</div>
  <p class="note"><strong>Hiện tượng:</strong> ${esc(rec.description || '')}</p>
  <p class="note"><strong>Phương án:</strong> ${esc(rec.solution || '')}</p>
  <p class="note"><strong>Kết quả:</strong> ${esc(rec.result || '')}</p>
  <div class="section">Chi phí</div>
  <table class="data">
    <thead><tr><th>Khoản mục</th><th>Số tiền (VNĐ)</th><th>Ghi chú</th></tr></thead>
    <tbody>
      <tr><td>Chi phí công / dịch vụ</td><td class="num">${money(rec.cost)}</td><td>${rec.warrantyClaim ? 'Trong thời hạn bảo hành' : ''}</td></tr>
      <tr><td>Chi phí vật tư thay thế</td><td class="num">${money(rec.partsCost)}</td><td></td></tr>
    </tbody>
    <tfoot><tr><td>TỔNG CỘNG</td><td class="num">${money((rec.cost || 0) + (rec.partsCost || 0))}</td><td></td></tr></tfoot>
  </table>
  ${signatures(ctx.settings, ['Người báo hỏng', 'Kỹ thuật viên', 'Trưởng bộ phận KT', 'Giám đốc'], ['', rec.technician || '', '', ctx.settings.company.representative], { docType: 'maintenance', docId: id, docCode: d.code, roles: ['reporter', 'technician', 'supervisor', 'manager'] })}`;
  return wrap(ctx.settings, title, body, { docType: 'maintenance', docId: id, docCode: d.code, roles: digisig.getRolesForDoc('maintenance') });
}

function disposalDoc(id, ctx) {
  const rec = store.find('disposals', id);
  if (!rec) return null;
  const d = service.decorate('disposals', rec);
  const title = 'BIÊN BẢN THANH LÝ TÀI SẢN';
  const body = `
  ${header(ctx.settings, title, '04-VT/BBTL', d.date)}
  <p class="note">Hôm nay, ngày ${date(d.date)}, Hội đồng thanh lý tài sản gồm các thành viên có tên sau đây tiến hành thanh lý các tài sản không còn khả năng sử dụng / hết thời hạn khấu hao:</p>
  <table class="data">
    <thead><tr><th style="width:50px">STT</th><th>Họ và tên</th><th>Chức vụ</th><th>Vai trò trong hội đồng</th></tr></thead>
    <tbody>
      ${(Array.isArray(rec.council) && rec.council.length ? rec.council : [ctx.settings.company.representative, ctx.settings.company.accountant]).map((m, i) => `<tr><td class="ctr">${i + 1}</td><td>${esc(m)}</td><td></td><td>${i === 0 ? 'Chủ tịch hội đồng' : 'Thành viên'}</td></tr>`).join('')}
    </tbody>
  </table>
  <div class="section">Tài sản thanh lý</div>
  <table class="data">
    <thead><tr><th style="width:40px">STT</th><th>Mã tài sản</th><th>Tên tài sản</th><th>Nguyên giá</th><th>Hao mòn luỹ kế</th><th>Giá trị còn lại</th><th>Giá trị thanh lý</th></tr></thead>
    <tbody>
      <tr><td class="ctr">1</td><td class="ctr">${esc(d.assetCode)}</td><td>${esc(d.assetName)}</td>
      <td class="num">${money(rec.originalCost)}</td><td class="num">${money(rec.accumulated)}</td>
      <td class="num">${money(rec.bookValue)}</td><td class="num">${money(rec.salePrice)}</td></tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3">TỔNG CỘNG</td><td class="num">${money(rec.originalCost)}</td><td class="num">${money(rec.accumulated)}</td><td class="num">${money(rec.bookValue)}</td><td class="num">${money(rec.salePrice)}</td></tr>
      <tr><td colspan="6">Chênh lệch (lãi/lỗ) thanh lý</td><td class="num">${money(d.profitLoss)}</td></tr>
    </tfoot>
  </table>
  ${infoTable([
    ['Hình thức thanh lý', esc(({ sale:'Bán thanh lý', scrap:'Bán phế liệu', donate:'Tặng/Cho', destroy:'Tiêu huỷ', writeoff:'Ghi giảm/Xoá sổ' }[rec.type] || ''))],
    ['Lý do thanh lý', esc(rec.reason || '')],
    ['Người/Đơn vị mua', esc(rec.buyerName || '')],
    ['MST người mua', esc(rec.buyerTaxCode || '')],
    ['Số hoá đơn', esc(rec.invoiceNo || '')],
    ['Chi phí thanh lý', money(rec.disposalCost)],
  ])}
  <p class="note">Hội đồng thống nhất thanh lý tài sản nêu trên và đề nghị bộ phận kế toán ghi giảm tài sản, hạch toán thu nhập/chi phí theo quy định hiện hành.</p>
  ${signatures(ctx.settings, ['Chủ tịch hội đồng', 'Uỷ viên', 'Kế toán', 'Giám đốc'], [(Array.isArray(rec.council) && rec.council[0]) || ctx.settings.company.representative, (Array.isArray(rec.council) && rec.council[1]) || '', ctx.settings.company.accountant, ctx.settings.company.representative], { docType: 'disposal', docId: id, docCode: d.code, roles: ['president', 'member', 'accountant', 'manager'] })}`;
  return wrap(ctx.settings, title, body, { docType: 'disposal', docId: id, docCode: d.code, roles: digisig.getRolesForDoc('disposal') });
}

function stocktakeDoc(id, ctx) {
  const rec = store.find('stocktakes', id);
  if (!rec) return null;
  const d = service.decorate('stocktakes', rec);
  const items = store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(rec.id)).map((i) => service.decorate('stocktake_items', i));
  const title = 'BIÊN BẢN KIỂM KÊ TÀI SẢN';
  const body = `
  ${header(ctx.settings, title, '05-VT/BBKK', d.endDate || d.startDate)}
  ${infoTable([
    ['Tên đợt kiểm kê', `<strong>${esc(rec.name)}</strong>`],
    ['Số đợt', esc(d.code)],
    ['Phạm vi', esc(({ all:'Toàn công ty', department:'Theo phòng ban', location:'Theo vị trí', category:'Theo danh mục' }[rec.scope] || '')) + (d.departmentName ? ' — ' + esc(d.departmentName) : '') + (d.locationName ? ' — ' + esc(d.locationName) : '')],
    ['Thời gian', `${rec.startDate ? date(rec.startDate) : ''} - ${rec.endDate ? date(rec.endDate) : ''}`],
    ['Trưởng ban kiểm kê', esc(d.leaderName || '')],
    ['Thành viên', esc((Array.isArray(rec.members) ? rec.members.join(', ') : rec.members) || '')],
    ['Kết quả', `${d.countedItems}/${d.totalItems} tài sản đã kiểm kê • ${d.diffItems} chênh lệch`],
  ])}
  <div class="section">Chi tiết kết quả kiểm kê</div>
  <table class="data">
    <thead><tr><th style="width:40px">STT</th><th>Mã tài sản</th><th>Tên tài sản</th><th>Vị trí sổ sách</th><th>Vị trí thực tế</th><th>Người sử dụng</th><th>Kết quả</th><th>Tình trạng</th></tr></thead>
    <tbody>
      ${items
        .map(
          (i, idx) => `<tr><td class="ctr">${idx + 1}</td><td class="ctr">${esc(i.assetCode)}</td><td>${esc(i.assetName)}</td>
          <td>${esc(i.expectedLocationName || '')}</td><td>${esc(i.locationName || '')}</td><td>${esc(i.assigneeName || '')}</td>
          <td class="ctr">${esc(({ match:'Khớp', missing:'Không tìm thấy', extra:'Phát hiện thêm', wrong_location:'Sai vị trí', damaged:'Hư hỏng' }[i.result] || ''))}</td>
          <td class="ctr">${esc(i.conditionLabel || '')}</td></tr>`
        )
        .join('')}
      ${items.length ? '' : '<tr><td colspan="8" class="ctr">Chưa có dòng kiểm kê</td></tr>'}
    </tbody>
    <tfoot><tr><td colspan="6">TỔNG CỘNG: ${items.length} tài sản — Khớp: ${items.filter((i) => i.result === 'match').length} — Chênh lệch: ${items.filter((i) => i.result && i.result !== 'match').length}</td><td colspan="2"></td></tr></tfoot>
  </table>
  <p class="note">Ban kiểm kê xác nhận số liệu trên là đúng với thực tế kiểm tra tại thời điểm lập biên bản. Các trường hợp chênh lệch đã được ghi nhận và đề xuất xử lý theo quy định.</p>
  ${signatures(ctx.settings, ['Trưởng ban kiểm kê', 'Thành viên', 'Kế toán', 'Giám đốc'], [d.leaderName, (Array.isArray(rec.members) && rec.members[0]) || '', ctx.settings.company.accountant, ctx.settings.company.representative], { docType: 'stocktake', docId: id, docCode: d.code, roles: ['leader', 'member', 'accountant', 'manager'] })}`;
  return wrap(ctx.settings, title, body, { docType: 'stocktake', docId: id, docCode: d.code, roles: digisig.getRolesForDoc('stocktake') });
}

function warrantyDoc(id, ctx) {
  const rec = store.find('warranties', id);
  if (!rec) return null;
  const d = service.decorate('warranties', rec);
  const title = 'PHIẾU YÊU CẦU BẢO HÀNH';
  const body = `
  ${header(ctx.settings, title, '06-VT/PBH', d.claimDate || d.startDate)}
  ${infoTable([
    ['Số phiếu', esc(d.code)],
    ['Tài sản', `${esc(d.assetName)} (${esc(d.assetCode)})`],
    ['Đơn vị bảo hành', esc(rec.provider || d.supplierName || '')],
    ['Thời hạn bảo hành', `${date(rec.startDate)} - ${date(rec.endDate)} (còn ${d.remainingDays} ngày)`],
    ['Phạm vi bảo hành', esc(rec.coverage || '')],
    ['Sự cố / Yêu cầu', esc(rec.issue || '')],
    ['Ngày yêu cầu', rec.claimDate ? date(rec.claimDate) : ''],
    ['Số lần yêu cầu trước đó', String(rec.claimCount || 0)],
  ])}
  <div class="section">Kết quả xử lý</div>
  <p class="note">${esc(rec.resolution || 'Chưa xử lý')}</p>
  ${infoTable([['Ngày hoàn tất', rec.resolvedDate ? date(rec.resolvedDate) : ''], ['Chi phí phát sinh', money(rec.cost)]])}
  ${signatures(ctx.settings, ['Người yêu cầu', 'Đại diện đơn vị bảo hành', 'Xác nhận của công ty'], ['', '', ctx.settings.company.representative], { docType: 'warranty', docId: id, docCode: d.code, roles: ['requester', 'provider', 'company'] })}`;
  return wrap(ctx.settings, title, body, { docType: 'warranty', docId: id, docCode: d.code, roles: digisig.getRolesForDoc('warranty') });
}

/* ---------------------------- Nhãn tem tài sản ----------------------------
 * Mỗi tem có:
 *  - Mã QR thật (bộ sinh ISO 18004 trong lib/qr.js) trỏ tới ams://asset/<mã>
 *  - Mã vạch Code128 thật (lib/barcode.js) mang chính mã tài sản, chạy hết
 *    chiều ngang tem (X-dimension ≈ 0,45 mm/module trên tem 88 mm)
 *  - Thông tin nhận diện nhanh + trường ghi tay cho người kiểm kê
 *
 * Kích thước tem luôn vừa đúng vùng in A4 (182 × 269 mm với @page margin 14 mm):
 *  2 nhãn → 1×2 (178×120) • 4 nhãn → 2×2 (88×120) • 8 nhãn → 2×4 (88×60)
 *  12 nhãn → 2×6 (88×40) • 16 nhãn → 2×8 (88×30)
 */
function labelLayout(copies) {
  if (copies <= 2) return { perRow: 1, w: 178, h: 120 };
  if (copies <= 4) return { perRow: 2, w: 88, h: 120 };
  if (copies <= 8) return { perRow: 2, w: 88, h: 60 };
  if (copies <= 12) return { perRow: 2, w: 88, h: 40 };
  return { perRow: 2, w: 88, h: 30 };
}

/** Markup một nhãn tem (dùng chung cho in 1 tài sản và in hàng loạt) */
function assetLabelMarkup(asset, ctx, w, h) {
  const qr = reportEngine.qrSVG('ams://asset/' + asset.code, 1, { ecc: 'Q', quiet: 4 });
  const bar = reportEngine.code128SVG(String(asset.code), 1, 1);
  const qtyLabel = Number(asset.quantity) > 1 ? `${Number(asset.quantity).toLocaleString('vi-VN')} ${asset.unit || 'cái'}` : '1 cái';
  const tier = h >= 100 ? 'full' : h >= 55 ? 'c1' : h >= 36 ? 'c2' : 'c3';
  const qrMm = tier === 'full' ? (w >= 150 ? 42 : 30) : tier === 'c1' ? 20 : tier === 'c2' ? 15 : 12;
  const barMm = tier === 'full' ? 10 : tier === 'c1' ? 6 : tier === 'c2' ? 4.5 : 4;
  const line = (label, value, size) =>
    `<div style="font-size:${size || 8}pt;color:#475569;line-height:1.35">${label} ${esc(value || '—')}</div>`;
  const pad = tier === 'full' ? '4mm 5mm' : tier === 'c1' ? '3mm 4mm' : '2.5mm 3.5mm';
  const head = tier === 'c3' ? '' : `
    <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #94a3b8;padding-bottom:${tier === 'c2' ? 1 : 1.5}px;margin-bottom:${tier === 'c2' ? 1.5 : 2}px">
      <div style="font-weight:700;font-size:${tier === 'full' ? 10 : tier === 'c1' ? 8.5 : 7}pt;text-transform:uppercase;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ctx.settings.company.shortName || ctx.settings.company.name)}</div>
      <div style="font-size:${tier === 'c1' ? 6.5 : 6}pt;color:#64748b;white-space:nowrap">NHÃN TÀI SẢN</div>
    </div>`;
  const codeSize = tier === 'full' ? 14 : tier === 'c1' ? 12 : tier === 'c2' ? 10.5 : 9;
  const nameSize = tier === 'full' ? 10 : tier === 'c1' ? 9 : tier === 'c2' ? 7.5 : 6.5;
  const nameLines = tier === 'c3' ? 1 : 2;
  const footer = tier === 'c3' ? '' : `
    <div style="flex:none;display:flex;gap:4px;font-size:6.5pt;color:#94a3b8;margin-top:${tier === 'c1' ? 1 : 1.5}px">
      <span>SL kiểm kê: ......</span><span>Ngày: __/__/____</span><span>Người KK: ..........</span>
    </div>`;
  return `
  <div class="tem" style="width:${w}mm;height:${h}mm;border:1.5px solid #0f172a;border-radius:3px;padding:${pad};font-family:Inter,Arial;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column">
    ${head}
    <div style="display:flex;gap:4px;flex:1;min-height:0">
      <div style="flex:1;min-width:0">
        <div style="font-size:6pt;color:#64748b;text-transform:uppercase;letter-spacing:.4px;line-height:1">${tier === 'full' || tier === 'c1' ? 'Mã tài sản' : ''}</div>
        <div style="font-weight:800;font-size:${codeSize}pt;letter-spacing:.5px;line-height:1.1;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(asset.code)}</div>
        <div style="font-size:${nameSize}pt;font-weight:600;line-height:1.2;max-height:${nameLines * (nameSize * 1.25)}px;overflow:hidden">${esc(asset.name)}</div>
        ${tier === 'full' ? line('Danh mục:', asset.categoryName) : ''}
        ${tier !== 'c3' ? line('Bộ phận:', asset.departmentName, tier === 'c2' ? 7 : 8) : ''}
        ${tier === 'full' ? line('Người sử dụng:', asset.assigneeName) : ''}
        ${tier !== 'c3' ? line('SL:', qtyLabel, tier === 'c2' ? 7 : 8) : ''}
        ${tier === 'full' ? `<div style="font-size:7pt;color:#64748b;margin-top:1px">Ngày mua: ${date(asset.purchaseDate)} • BH đến ${date(asset.warrantyEnd)}</div>` : ''}
      </div>
      <div style="width:${qrMm}mm;flex:none;text-align:center">
        <div style="width:${qrMm}mm;height:${qrMm}mm;margin:0 auto">${qr}</div>
        ${tier !== 'c3' ? `<div style="font-family:monospace;font-size:${tier === 'c2' ? 6 : 7}pt;letter-spacing:.5px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(asset.code)}</div>` : ''}
      </div>
    </div>

    <div style="height:${barMm}mm;flex:none;margin-top:2px">${bar}</div>
    ${footer}
  </div>`;
}

/**
 * Tờ nhãn tem tài sản (1 tài sản, nhiều bản). ?copies=2|4|8|12|16 (mặc định 8).
 */
function assetLabelDoc(id, ctx, opts) {
  const asset = service.decorateAsset(store.find('assets', id));
  if (!asset) return null;
  const o = opts || {};
  const copies = Math.max(1, Math.min(16, Number(o.copies) || 8));
  const L = labelLayout(copies);
  const units = Array.from({ length: copies }, () => asset);
  return labelSheetBody(units, L, `Tờ tem ${copies} nhãn (A4) — mã QR trỏ tới <span class="mono">ams://asset/${esc(asset.code)}</span>, quét bằng điện thoại để mở hồ sơ tài sản hoặc kiểm kê nhanh.`, 'NHÃN TÀI SẢN — ' + asset.code, ctx);
}

/**
 * IN TEM HÀNG LOẠT — 1 lượt ra nhiều tài sản (mỗi tài sản 1 tem), tự phân trang A4.
 * Nguồn danh sách (theo thứ tự ưu tiên):
 *  - assetIds=1,2,3          : danh sách tài sản đã chọn
 *  - stocktakeId=<id>        : toàn bộ danh sách của một đợt kiểm kê
 *  - departmentId / locationId / categoryId : theo phạm vi phòng ban / vị trí / danh mục
 *  - copies=<n> (mặc định 1, tối đa 4): số bản tem cho mỗi tài sản
 */
function assetLabelsBatchDoc(params, ctx) {
  const p = params || {};
  const ids = String(p.assetIds || '').split(',').map((s) => s.trim()).filter(Boolean);
  let assets = [];
  if (ids.length) {
    assets = ids.map((x) => store.find('assets', x)).filter((a) => a && !a.isDeleted);
  } else if (p.stocktakeId) {
    const seen = new Set();
    store.filter('stocktake_items', (i) => String(i.stocktakeId) === String(p.stocktakeId)).forEach((i) => {
      if (seen.has(String(i.assetId))) return;
      seen.add(String(i.assetId));
      const a = store.find('assets', i.assetId);
      if (a && !a.isDeleted) assets.push(a);
    });
  } else {
    assets = store.filter('assets', (a) => !a.isDeleted && !['disposed'].includes(a.status));
    if (p.departmentId) assets = assets.filter((a) => String(a.departmentId) === String(p.departmentId));
    if (p.locationId) assets = assets.filter((a) => String(a.locationId) === String(p.locationId));
    if (p.categoryId) assets = assets.filter((a) => String(a.categoryId) === String(p.categoryId));
  }
  const copies = Math.max(1, Math.min(4, Number(p.copies) || 1));
  const L = { w: 88, h: 60 }; // 2 cột × 4 hàng = 8 tem/tờ A4
  const perPage = L.perRow || 2, rowsPerPage = 4;
  const units = [];
  assets.forEach((a) => { for (let i = 0; i < copies; i++) units.push(a); });
  const note = `${assets.length} tài sản • ${units.length} tem • ${copies > 1 ? copies + ' bản/tài sản • ' : ''}8 tem mỗi tờ A4 — quét bằng điện thoại để kiểm kê nhanh hoặc mở hồ sơ tài sản.`;
  return labelSheetBody(units, Object.assign({ perPage: perPage * rowsPerPage }, L), note, 'NHÃN TÀI SẢN — IN HÀNG LOẠT (' + assets.length + ' TÀI SẢN)', ctx);
}

/** Dựng các tờ A4 (mỗi tờ tối đa 8 tem) từ danh sách tài sản, tự phân trang */
function labelSheetBody(units, L, note, title, ctx) {
  const perPage = L.perPage || 8;
  const pages = [];
  for (let i = 0; i < units.length; i += perPage) pages.push(units.slice(i, i + perPage));
  const body = pages.map((pg, pi) => `
  <div class="sheet label-sheet">
    <div style="display:flex;flex-wrap:wrap;gap:4mm;justify-content:flex-start">
      ${pg.map((a) => assetLabelMarkup(service.decorateAsset(a), ctx, L.w, L.h)).join('')}
    </div>
    <div style="font-size:8pt;color:#64748b;margin-top:3mm">${pages.length > 1 ? `Tờ ${pi + 1}/${pages.length} • ` : ''}${note}</div>
  </div>`).join('');
  return wrap(ctx.settings, title, body, { autoPrint: false, multiSheet: true });
}

function depreciationDoc(id, ctx) {
  const assetId = id;
  const asset = store.find('assets', assetId);
  if (!asset) return null;
  const rows = store.filter('depreciations', (d) => String(d.assetId) === String(assetId) && !d.isDeleted).sort((a, b) => String(a.period).localeCompare(String(b.period)));
  const dec = service.decorateAsset(asset);
  const title = 'BẢNG TÍNH KHẤU HAO TÀI SẢN';
  const body = `
  ${header(ctx.settings, title, '07-VT/BKH', new Date().toISOString())}
  ${infoTable([
    ['Tài sản', `${esc(asset.name)} (${esc(asset.code)})`],
    ['Danh mục', esc(dec.categoryName)],
    ['Nguyên giá', money(dec.originalCost)],
    ['Phương pháp khấu hao', esc(({ straight_line:'Đường thẳng', declining_balance:'Số dư giảm dần', double_declining:'Số dư giảm dần kép', sum_of_years:'Tổng số năm', productive:'Theo sản lượng', none:'Không khấu hao' }[asset.depreciationMethod] || ''))],
    ['Thời gian sử dụng', (asset.usefulLife || 0) + ' tháng'],
    ['Bắt đầu tính khấu hao', date(asset.depreciationStart || asset.purchaseDate)],
    ['Mức khấu hao/tháng', money(dec.monthlyDepreciation)],
    ['Hao mòn luỹ kế', money(dec.accumulatedDepreciation)],
    ['Giá trị còn lại', money(dec.bookValue)],
  ])}
  <div class="section">Bảng khấu hao theo kỳ</div>
  <table class="data">
    <thead><tr><th style="width:40px">STT</th><th>Kỳ</th><th>Giá trị đầu kỳ</th><th>Khấu hao trong kỳ</th><th>Hao mòn luỹ kế</th><th>Giá trị còn lại</th><th>TK Nợ</th><th>TK Có</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r, i) => `<tr><td class="ctr">${i + 1}</td><td class="ctr">${esc(r.period)}</td><td class="num">${money(r.openingValue)}</td><td class="num">${money(r.depreciationAmount)}</td><td class="num">${money(r.accumulated)}</td><td class="num">${money(r.closingValue)}</td><td class="ctr">${esc(r.expenseAccount || '')}</td><td class="ctr">${esc(r.assetAccount || '')}</td></tr>`
        )
        .join('')}
    </tbody>
    <tfoot><tr><td colspan="3">TỔNG KHẤU HAO ĐÃ GHI SỔ</td><td class="num">${money(rows.reduce((s, r) => s + Number(r.depreciationAmount || 0), 0))}</td><td colspan="4"></td></tr></tfoot>
  </table>
  ${signatures(ctx.settings, ['Người lập biểu', 'Kế toán trưởng', 'Giám đốc'], ['', ctx.settings.company.accountant, ctx.settings.company.representative], { docType: 'depreciation', docId: id, docCode: dec.code, roles: ['preparer', 'accountant', 'manager'] })}`;
  return wrap(ctx.settings, title, body, { docType: 'depreciation', docId: id, docCode: dec.code, roles: digisig.getRolesForDoc('depreciation') });
}

function contractDoc(id, ctx) {
  const rec = store.find('contracts', id);
  if (!rec) return null;
  const d = service.decorate('contracts', rec);
  const assets = store.filter('assets', (a) => String(a.contractId) === String(rec.id)).map((a) => service.decorateAsset(a));
  const title = 'BẢNG KÊ TÀI SẢN THEO HỢP ĐỒNG';
  const body = `
  ${header(ctx.settings, title, '08-VT/BKHĐ', rec.signDate)}
  ${infoTable([
    ['Hợp đồng', `${esc(rec.name)} (${esc(d.code)})`],
    ['Đối tác', esc(d.supplierName)],
    ['Loại hợp đồng', esc(({ purchase:'Mua sắm', lease_in:'Thuê vào', lease_out:'Cho thuê', service:'Dịch vụ', insurance:'Bảo hiểm', construction:'Thi công' }[rec.type] || ''))],
    ['Giá trị hợp đồng', money(rec.value) + ' ' + esc(rec.currency || 'VND')],
    ['Hiệu lực', `${date(rec.startDate)} - ${date(rec.endDate)}`],
    ['Điều khoản thanh toán', esc(rec.paymentTerms || '')],
  ])}
  <div class="section">Tài sản thuộc hợp đồng</div>
  <table class="data">
    <thead><tr><th style="width:40px">STT</th><th>Mã</th><th>Tên tài sản</th><th>Ngày mua</th><th>Nguyên giá</th><th>Giá trị còn lại</th><th>Trạng thái</th></tr></thead>
    <tbody>
      ${assets
        .map(
          (a, i) => `<tr><td class="ctr">${i + 1}</td><td class="ctr">${esc(a.code)}</td><td>${esc(a.name)}</td><td class="ctr">${date(a.purchaseDate)}</td>
          <td class="num">${money(a.originalCost)}</td><td class="num">${money(a.bookValue)}</td><td class="ctr">${esc(({ in_stock:'Trong kho', in_use:'Đang sử dụng', maintenance:'Bảo trì', disposed:'Đã thanh lý' }[a.status] || a.status))}</td></tr>`
        )
        .join('')}
      ${assets.length ? '' : '<tr><td colspan="7" class="ctr">Chưa có tài sản nào gắn với hợp đồng này</td></tr>'}
    </tbody>
    <tfoot><tr><td colspan="4">TỔNG CỘNG</td><td class="num">${money(assets.reduce((s, a) => s + Number(a.originalCost || 0), 0))}</td><td class="num">${money(assets.reduce((s, a) => s + Number(a.bookValue || 0), 0))}</td><td></td></tr></tfoot>
  </table>
  ${signatures(ctx.settings, ['Người lập bảng kê', 'Kế toán trưởng', 'Giám đốc'], ['', ctx.settings.company.accountant, ctx.settings.company.representative], { docType: 'contract', docId: id, docCode: d.code, roles: ['preparer', 'accountant', 'manager'] })}`;
  return wrap(ctx.settings, title, body, { docType: 'contract', docId: id, docCode: d.code, roles: digisig.getRolesForDoc('contract') });
}

const HANDLERS = {
  assignment: assignmentDoc,
  transfer: transferDoc,
  maintenance: maintenanceDoc,
  disposal: disposalDoc,
  stocktake: stocktakeDoc,
  warranty: warrantyDoc,
  label: assetLabelDoc,
  depreciation: depreciationDoc,
  contract: contractDoc,
};

function render(type, id, options) {
  const ctx = options || {};
  const handler = HANDLERS[type];
  if (!handler) return null;
  // Tham số truy vấn của yêu cầu (ví dụ ?copies=12 khi in nhãn tem) — URLSearchParams → object
  let q = ctx.query;
  if (q && typeof q.get === 'function') {
    const flat = {};
    q.forEach((value, key) => { flat[key] = value; });
    q = flat;
  }
  return handler(id, ctx, q || {});
}

module.exports = { render, HANDLERS, assetLabelsBatch: assetLabelsBatchDoc, assetLabelMarkup, labelLayout };
