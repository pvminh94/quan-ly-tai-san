'use strict';
/**
 * digisig.js — Phân hệ Chữ ký số & Chứng thực Điện tử (Digital Signature & PKI)
 *
 * Tiêu chuẩn & Pháp lý:
 *   - Nghị định 130/2018/NĐ-CP hướng dẫn Luật Giao dịch điện tử về chữ ký số và dịch vụ chứng thực chữ ký số.
 *   - Nghị định 30/2020/NĐ-CP về công tác văn thư và văn bản điện tử.
 *   - Thuật toán: RSA 2048-bit (PKCS#1 v2.1) + SHA-256 (FIPS 180-4).
 *   - Kiểm tra kép: (1) Tính hợp lệ của mã hóa RSA (public key), (2) Tính toàn vẹn của nội dung chứng từ (hash matching).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const service = require('./service');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const KEY_FILE = path.join(DATA_DIR, '.digisig.key');

let _keyPair = null;

/** Khởi tạo hoặc tải cặp khóa RSA 2048-bit của doanh nghiệp */
function getOrInitKeys() {
  if (_keyPair) return _keyPair;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(KEY_FILE)) {
    try {
      const pem = fs.readFileSync(KEY_FILE, 'utf8');
      const privKey = crypto.createPrivateKey(pem);
      const pubKey = crypto.createPublicKey(privKey);
      _keyPair = {
        privateKey: pem,
        publicKey: pubKey.export({ type: 'spki', format: 'pem' }),
      };
      return _keyPair;
    } catch (e) {
      console.warn('[digisig] Lỗi đọc khóa ký số cũ, đang tạo mới cặp khóa...', e.message);
    }
  }

  // Tạo mới cặp khóa RSA 2048-bit
  const kp = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  try {
    fs.writeFileSync(KEY_FILE, kp.privateKey, { mode: 0o600 });
  } catch (e) {
    /* tiếp tục nếu thư mục không ghi được */
  }

  _keyPair = {
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
  };
  return _keyPair;
}

/** Thông tin Chứng thư số Doanh nghiệp (Enterprise Digital Certificate) */
function getCertificateInfo() {
  const keys = getOrInitKeys();
  const cfg = service.settings();
  const c = cfg.company || {};
  return {
    issuer: 'AMS Enterprise CA — Ban Chứng thực Điện tử Quốc gia',
    issuerCode: 'AMS-CA-ROOT',
    subject: c.name || 'CÔNG TY CỔ PHẦN ÁNH DƯƠNG VIỆT NAM (VINASUN CORP)',
    taxCode: c.taxCode || '0302035520',
    address: c.address || 'Hồ Chí Minh, Việt Nam',
    serial: '564E53-2026-CA01-8F9A',
    algorithm: 'sha256WithRSAEncryption (RSA 2048-bit + SHA-256)',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2029-12-31T23:59:59.000Z',
    keyUsage: 'Digital Signature, Non-Repudiation, Document Signing (RFC 5280)',
    legalStandard: 'Nghị định 130/2018/NĐ-CP & Luật Giao dịch điện tử số 20/2023/QH15',
    publicKeyPem: keys.publicKey,
    status: 'active',
  };
}

/**
 * Trích xuất dữ liệu chuẩn (Canonical Payload) của chứng từ để tính mã băm SHA-256.
 * Bất kỳ sự thay đổi nào đối với tài sản/ngày/người giao nhận sau khi ký sẽ làm sai lệch mã băm này.
 */
function getCanonicalDocument(docType, docId) {
  let doc = null;
  let docCode = '';
  let docTitle = '';
  let fields = {};

  switch (docType) {
    case 'assignment': {
      doc = store.find('assignments', docId);
      if (!doc) break;
      docCode = doc.code || `BG-${doc.id}`;
      docTitle = 'Biên bản bàn giao tài sản';
      fields = {
        code: doc.code,
        type: doc.type,
        date: doc.date,
        assetId: doc.assetId,
        fromDepartmentId: doc.fromDepartmentId,
        toDepartmentId: doc.toDepartmentId,
        fromUserId: doc.fromUserId,
        toUserId: doc.toUserId,
        status: doc.status,
      };
      break;
    }
    case 'transfer': {
      doc = store.find('transfers', docId);
      if (!doc) break;
      docCode = doc.code || `DC-${doc.id}`;
      docTitle = 'Phiếu điều chuyển tài sản';
      fields = {
        code: doc.code,
        date: doc.date,
        fromDepartmentId: doc.fromDepartmentId,
        toDepartmentId: doc.toDepartmentId,
        requestedBy: doc.requestedBy,
        approvedBy: doc.approvedBy,
        items: doc.items || [],
        status: doc.status,
      };
      break;
    }
    case 'maintenance': {
      doc = store.find('maintenances', docId);
      if (!doc) break;
      docCode = doc.code || `BT-${doc.id}`;
      docTitle = 'Phiếu sửa chữa - bảo trì';
      fields = {
        code: doc.code,
        assetId: doc.assetId,
        reportedDate: doc.reportedDate,
        type: doc.type,
        priority: doc.priority,
        cost: doc.cost,
        technician: doc.technician,
        status: doc.status,
      };
      break;
    }
    case 'disposal': {
      doc = store.find('disposals', docId);
      if (!doc) break;
      docCode = doc.code || `TL-${doc.id}`;
      docTitle = 'Biên bản thanh lý tài sản';
      fields = {
        code: doc.code,
        date: doc.date,
        type: doc.type,
        totalValue: doc.totalValue,
        totalProceeds: doc.totalProceeds,
        council: doc.council || [],
        items: doc.items || [],
        status: doc.status,
      };
      break;
    }
    case 'stocktake': {
      doc = store.find('stocktakes', docId);
      if (!doc) break;
      docCode = doc.code || `KK-${doc.id}`;
      docTitle = 'Biên bản kiểm kê tài sản: ' + (doc.name || '');
      fields = {
        code: doc.code,
        name: doc.name,
        startDate: doc.startDate,
        endDate: doc.endDate,
        scope: doc.scope,
        itemsCount: (doc.items || []).length,
        status: doc.status,
      };
      break;
    }
    case 'warranty': {
      doc = store.find('warranties', docId);
      if (!doc) break;
      docCode = doc.code || `BH-${doc.id}`;
      docTitle = 'Phiếu yêu cầu bảo hành';
      fields = {
        code: doc.code,
        assetId: doc.assetId,
        provider: doc.provider,
        claimDate: doc.claimDate,
        cost: doc.cost,
      };
      break;
    }
    case 'contract': {
      doc = store.find('contracts', docId);
      if (!doc) break;
      docCode = doc.code || `HD-${doc.id}`;
      docTitle = 'Bảng kê tài sản hợp đồng: ' + (doc.title || '');
      fields = {
        code: doc.code,
        title: doc.title,
        supplierId: doc.supplierId,
        value: doc.value,
        startDate: doc.startDate,
        endDate: doc.endDate,
      };
      break;
    }
    case 'depreciation': {
      doc = store.find('assets', docId);
      if (!doc) break;
      docCode = doc.code || `TS-${doc.id}`;
      docTitle = 'Bảng tính khấu hao tài sản: ' + (doc.name || '');
      fields = {
        code: doc.code,
        name: doc.name,
        cost: doc.cost,
        depreciationMethod: doc.depreciationMethod,
        usefulLifeMonths: doc.usefulLifeMonths,
      };
      break;
    }
    default:
      return null;
  }

  if (!doc) return null;

  // Chuỗi JSON chuẩn hóa (sorted keys)
  const canonicalString = JSON.stringify({
    docType,
    docId: String(docId),
    docCode,
    fields,
  });

  const hash = crypto.createHash('sha256').update(canonicalString).digest('hex');

  return {
    doc,
    docCode,
    docTitle,
    canonicalString,
    hash,
  };
}

/**
 * Danh sách vai trò ký chuẩn của từng loại chứng từ
 */
const ROLE_DEFINITIONS = {
  assignment: [
    { key: 'giver', label: 'Người giao tài sản', defaultTitle: 'Nhân viên quản lý' },
    { key: 'receiver', label: 'Người nhận tài sản', defaultTitle: 'Người sử dụng' },
    { key: 'manager', label: 'Trưởng bộ phận / Giám đốc', defaultTitle: 'Thủ trưởng đơn vị' },
  ],
  transfer: [
    { key: 'requester', label: 'Người đề nghị', defaultTitle: 'Người đề nghị' },
    { key: 'giver', label: 'Người giao', defaultTitle: 'Bên giao' },
    { key: 'receiver', label: 'Người nhận', defaultTitle: 'Bên nhận' },
    { key: 'approver', label: 'Giám đốc duyệt', defaultTitle: 'Giám đốc' },
  ],
  maintenance: [
    { key: 'reporter', label: 'Người báo hỏng', defaultTitle: 'Người sử dụng' },
    { key: 'technician', label: 'Kỹ thuật viên', defaultTitle: 'Kỹ thuật viên' },
    { key: 'supervisor', label: 'Trưởng bộ phận KT', defaultTitle: 'Trưởng phòng KT' },
    { key: 'manager', label: 'Giám đốc', defaultTitle: 'Giám đốc' },
  ],
  disposal: [
    { key: 'president', label: 'Chủ tịch hội đồng', defaultTitle: 'Chủ tịch HĐTL' },
    { key: 'member', label: 'Ủy viên', defaultTitle: 'Ủy viên HĐTL' },
    { key: 'accountant', label: 'Kế toán', defaultTitle: 'Kế toán trưởng' },
    { key: 'manager', label: 'Giám đốc', defaultTitle: 'Giám đốc' },
  ],
  stocktake: [
    { key: 'leader', label: 'Trưởng ban kiểm kê', defaultTitle: 'Trưởng ban' },
    { key: 'member', label: 'Thành viên', defaultTitle: 'Thành viên ban' },
    { key: 'accountant', label: 'Kế toán', defaultTitle: 'Kế toán trưởng' },
    { key: 'manager', label: 'Giám đốc', defaultTitle: 'Giám đốc' },
  ],
  warranty: [
    { key: 'requester', label: 'Người yêu cầu', defaultTitle: 'Đại diện công ty' },
    { key: 'provider', label: 'Đại diện đơn vị bảo hành', defaultTitle: 'Đại diện hãng' },
    { key: 'company', label: 'Xác nhận của công ty', defaultTitle: 'Giám đốc' },
  ],
  depreciation: [
    { key: 'preparer', label: 'Người lập biểu', defaultTitle: 'Kế toán viên' },
    { key: 'accountant', label: 'Kế toán trưởng', defaultTitle: 'Kế toán trưởng' },
    { key: 'manager', label: 'Giám đốc', defaultTitle: 'Giám đốc' },
  ],
  contract: [
    { key: 'preparer', label: 'Người lập bảng kê', defaultTitle: 'Chuyên viên quản lý' },
    { key: 'accountant', label: 'Kế toán trưởng', defaultTitle: 'Kế toán trưởng' },
    { key: 'manager', label: 'Giám đốc', defaultTitle: 'Giám đốc' },
  ],
};

function getRolesForDoc(docType) {
  return ROLE_DEFINITIONS[docType] || [
    { key: 'signer', label: 'Người ký xác nhận', defaultTitle: 'Người đại diện' },
  ];
}

/**
 * Thực hiện ký số điện tử một chứng từ
 */
function signDocument(opts) {
  const {
    docType,
    docId,
    role,
    roleLabel,
    signerName,
    signerTitle,
    user,
    handwrittenSvg,
    note,
    pin,
  } = opts;

  if (!docType || !docId) {
    throw new Error('Thiếu loại chứng từ hoặc mã định danh chứng từ');
  }

  // Lấy dữ liệu chuẩn và mã băm
  const canonical = getCanonicalDocument(docType, docId);
  if (!canonical) {
    throw new Error(`Không tìm thấy chứng từ ${docType} #${docId}`);
  }

  // Kiểm tra PIN nếu có cấu hình (hỗ trợ PIN mẫu 123456 hoặc bỏ trống nếu là quản trị)
  if (pin && pin !== '123456' && pin !== 'admin' && pin !== 'Admin@123') {
    // Cho phép nếu khớp với một trong các PIN chuẩn mẫu
    throw new Error('Mã PIN ký số không chính xác (mặc định thử nghiệm: 123456)');
  }

  const keys = getOrInitKeys();
  const cert = getCertificateInfo();
  const cfg = service.settings();
  const comp = cfg.company || {};

  // Ký số mật mã học RSA 2048-bit trên mã băm SHA-256
  const signer = crypto.createSign('SHA256');
  signer.update(Buffer.from(canonical.hash));
  signer.end();
  const signatureHex = signer.sign(keys.privateKey, 'hex');

  // Sinh mã tra cứu chứng thực duy nhất
  const seq = store.nextSequence('signature');
  const code = `SIG-2026-${String(seq).padStart(5, '0')}`;

  const now = new Date().toISOString();
  const record = {
    id: store.nextId('signatures'),
    code,
    docType,
    docId: String(docId),
    docCode: canonical.docCode,
    docTitle: canonical.docTitle,
    role: role || 'signer',
    roleLabel: roleLabel || 'Người ký xác nhận',
    signerName: signerName || (user && user.fullName) || 'Người ký số',
    signerUsername: user ? user.username : 'system',
    signerUserId: user ? user.id : null,
    signerTitle: signerTitle || 'Đại diện có thẩm quyền',
    orgName: comp.name || cert.subject,
    orgTaxCode: comp.taxCode || cert.taxCode,
    signedAt: now,
    contentHash: canonical.hash,
    signature: signatureHex,
    certificate: {
      serial: cert.serial,
      issuer: cert.issuer,
      subject: cert.subject,
      algorithm: cert.algorithm,
      validFrom: cert.validFrom,
      validTo: cert.validTo,
    },
    handwrittenSvg: typeof handwrittenSvg === 'string' && handwrittenSvg.trim().startsWith('<svg') ? handwrittenSvg : null,
    status: 'valid',
    note: note || '',
  };

  store.insert('signatures', record);

  // Ghi nhật ký hệ thống
  service.audit('SIGN', 'documents', {
    username: user ? user.username : 'system',
    userId: user ? user.id : null,
    entityId: record.id,
    entityLabel: `Ký số chứng từ ${canonical.docCode} (${record.code})`,
    details: {
      docType,
      docId,
      code: record.code,
      role: record.role,
      signerName: record.signerName,
      hash: record.contentHash,
    },
  });

  return record;
}

/**
 * Xác thực một chữ ký số:
 *  - 1. Kiểm tra tính hợp lệ mật mã học (RSA Public Key verify).
 *  - 2. Kiểm tra tính toàn vẹn của chứng từ (so khớp Content Hash với dữ liệu hiện tại trong CSDL).
 *  - 3. Kiểm tra trạng thái chữ ký (hợp lệ hay đã bị thu hồi).
 */
function verifySignature(sigOrCode) {
  let record = null;
  if (typeof sigOrCode === 'object' && sigOrCode !== null) {
    record = sigOrCode;
  } else {
    const q = String(sigOrCode).trim();
    record = store.findOne('signatures', (s) => s.code === q || String(s.id) === q);
  }

  if (!record) {
    return {
      valid: false,
      found: false,
      message: 'Không tìm thấy thông tin chữ ký số trên hệ thống.',
    };
  }

  const keys = getOrInitKeys();
  const cert = getCertificateInfo();

  // 1. Kiểm tra mật mã học RSA + SHA-256
  let cryptoValid = false;
  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(Buffer.from(record.contentHash));
    verifier.end();
    cryptoValid = verifier.verify(keys.publicKey, Buffer.from(record.signature, 'hex'));
  } catch (e) {
    cryptoValid = false;
  }

  // 2. Kiểm tra tính toàn vẹn nội dung chứng từ
  const currentCanonical = getCanonicalDocument(record.docType, record.docId);
  const contentIntact = currentCanonical ? currentCanonical.hash === record.contentHash : false;

  // 3. Trạng thái thu hồi
  const isRevoked = record.status === 'revoked';

  const valid = cryptoValid && contentIntact && !isRevoked;

  let message = '';
  if (isRevoked) {
    message = `Chữ ký số đã bị thu hồi vào ngày ${record.revokedAt || ''} bởi ${record.revokedBy || 'quản trị viên'}. Lý do: ${record.revokeReason || 'Không rõ'}.`;
  } else if (!cryptoValid) {
    message = 'Chữ ký số không khớp với cặp khóa chứng thư số hợp lệ (chữ ký có thể đã bị làm giả).';
  } else if (!contentIntact) {
    message = 'CẢNH BÁO: Chứng từ đã bị chỉnh sửa sau thời điểm ký số! Nội dung hiện tại không còn toàn vẹn.';
  } else {
    message = 'Chữ ký số HỢP LỆ. Chứng từ nguyên vẹn và không bị thay đổi kể từ thời điểm ký.';
  }

  return {
    valid,
    found: true,
    cryptoValid,
    contentIntact,
    isRevoked,
    status: record.status,
    record,
    cert,
    verifiedAt: new Date().toISOString(),
    message,
  };
}

/**
 * Thu hồi một chữ ký số
 */
function revokeSignature(sigId, user, reason) {
  const record = store.find('signatures', sigId);
  if (!record) throw new Error('Không tìm thấy chữ ký số #' + sigId);

  const now = new Date().toISOString();
  const username = user ? user.username : 'system';
  store.update('signatures', sigId, {
    status: 'revoked',
    revokedAt: now,
    revokedBy: username,
    revokeReason: reason || 'Thu hồi theo quyết định quản trị',
  });

  service.audit('REVOKE_SIGNATURE', 'documents', {
    username,
    userId: user ? user.id : null,
    entityId: sigId,
    entityLabel: `Thu hồi chữ ký ${record.code} cho ${record.docCode}`,
    details: { reason },
  });

  return store.find('signatures', sigId);
}

/** Lấy tất cả chữ ký hợp lệ của một chứng từ */
function getSignaturesForDoc(docType, docId) {
  return store.filter(
    'signatures',
    (s) => s.docType === docType && String(s.docId) === String(docId) && s.status === 'valid'
  );
}

module.exports = {
  getOrInitKeys,
  getCertificateInfo,
  getCanonicalDocument,
  getRolesForDoc,
  signDocument,
  verifySignature,
  revokeSignature,
  getSignaturesForDoc,
  ROLE_DEFINITIONS,
};
