'use strict';
/**
 * auth.js — Xác thực & phân quyền
 * - Mật khẩu: scrypt + salt ngẫu nhiên (không lưu plaintext)
 * - Token: JSON payload + chữ ký HMAC-SHA256 (chuẩn JWT-like, tự viết, zero-dep)
 * - Phiên làm việc lưu trong collection `sessions` để quản trị & thu hồi từ xa
 */

const crypto = require('crypto');
const store = require('./store');

/* --------------------------- Mật khẩu --------------------------- */

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { salt: s, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ----------------------------- Token ----------------------------- */

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signToken(payload, hours) {
  const secret = store.secretKey();
  const exp = Date.now() + (hours || 12) * 3600 * 1000;
  const body = Object.assign({}, payload, { exp, iat: Date.now(), jti: crypto.randomUUID() });
  const data = b64url(JSON.stringify(body));
  const sig = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  return { token: data + '.' + sig, payload: body };
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const secret = store.secretKey();
  const expected = b64url(crypto.createHmac('sha256', secret).update(parts[0]).digest());
  if (expected !== parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/* --------------------------- Phân quyền --------------------------- */

const ADMIN_ROLE = 'ADMIN';

function permissionsOf(user) {
  if (!user) return {};
  if (user.roleCode === ADMIN_ROLE) {
    const schema = require('./schema');
    return schema.fullPermissions();
  }
  const role = store.find('roles', user.roleId);
  return (role && role.permissions) || {};
}

function can(user, moduleKey, action) {
  if (!user) return false;
  if (user.isSuperAdmin || user.roleCode === ADMIN_ROLE) return true;
  const perms = user._permissions || permissionsOf(user);
  const list = perms[moduleKey];
  if (!list) return false;
  return list.includes('*') || list.includes(action);
}

/** Gắn quyền đã tính sẵn vào object user để tránh tra cứu lặp */
function decorateUser(user) {
  if (!user) return null;
  const role = store.find('roles', user.roleId);
  const safe = Object.assign({}, user);
  delete safe.passwordHash;
  delete safe.passwordSalt;
  safe.roleCode = role ? role.code : (user.username === 'admin' ? ADMIN_ROLE : 'USER');
  safe.roleName = role ? role.name : 'Người dùng';
  safe._permissions = role && role.permissions ? role.permissions : (safe.roleCode === ADMIN_ROLE ? require('./schema').fullPermissions() : {});
  safe.isSuperAdmin = safe.roleCode === ADMIN_ROLE;
  return safe;
}

/** Kiểm tra mật khẩu đủ mạnh */
function validatePasswordStrength(password, settings) {
  const min = (settings && settings.system && settings.system.passwordMinLength) || 6;
  const errors = [];
  if (!password || String(password).length < min) errors.push(`Mật khẩu phải có ít nhất ${min} ký tự`);
  if (password && !/[A-Za-z]/.test(password)) errors.push('Mật khẩu phải chứa ký tự chữ');
  if (password && !/[0-9]/.test(password)) errors.push('Mật khẩu phải chứa ký tự số');
  return errors;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  can,
  permissionsOf,
  decorateUser,
  validatePasswordStrength,
  ADMIN_ROLE,
};
