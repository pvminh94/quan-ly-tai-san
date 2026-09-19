'use strict';
/**
 * store.js — Lớp lưu trữ JSON an toàn (zero-dependency)
 * -----------------------------------------------------
 * - Load toàn bộ CSDL vào RAM khi khởi động, ghi xuống đĩa theo cơ chế
 *   atomic write (ghi file tạm -> rename) và debounce để tránh I/O nhiều.
 * - Hỗ trợ: collections, auto-increment id, soft delete, meta counters.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

class Store {
  constructor() {
    this.collections = {};
    this.meta = {};
    this.counters = {};
    this._writeTimer = null;
    this._dirty = false;
    this.startedAt = new Date().toISOString();
  }

  init() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        this.collections = raw.collections || {};
        this.meta = raw.meta || {};
        this.counters = raw.counters || {};
      } catch (e) {
        // File hỏng -> giữ bản backup và tạo mới
        const broken = DB_FILE + '.broken.' + Date.now();
        fs.renameSync(DB_FILE, broken);
        console.error(`[store] CSDL bị lỗi, đã chuyển sang ${broken} và tạo mới.`);
      }
    }
    return this;
  }

  isEmpty() {
    return Object.keys(this.collections).every((k) => !this.collections[k] || this.collections[k].length === 0);
  }

  /** Khai báo collection nếu chưa có */
  ensure(name) {
    if (!this.collections[name]) this.collections[name] = [];
    return this.collections[name];
  }

  all(name) {
    return this.ensure(name);
  }

  /** Tìm theo id */
  find(name, id) {
    return this.all(name).find((d) => String(d.id) === String(id)) || null;
  }

  findOne(name, predicate) {
    return this.all(name).find(predicate) || null;
  }

  filter(name, predicate) {
    return this.all(name).filter(predicate);
  }

  /** Sinh id tăng dần theo từng collection */
  nextId(name) {
    this.counters[name] = (this.counters[name] || 0) + 1;
    this.markDirty();
    return this.counters[name];
  }

  /** Sinh số thứ tự cho quy tắc đánh mã (numbering rules) */
  nextSequence(key) {
    this.meta.seq = this.meta.seq || {};
    this.meta.seq[key] = (this.meta.seq[key] || 0) + 1;
    this.markDirty();
    return this.meta.seq[key];
  }

  peekSequence(key) {
    this.meta.seq = this.meta.seq || {};
    return this.meta.seq[key] || 0;
  }

  insert(name, doc) {
    const collection = this.all(name);
    const now = new Date().toISOString();
    const record = Object.assign({}, doc);
    if (record.id === undefined || record.id === null) record.id = this.nextId(name);
    if (!record.createdAt) record.createdAt = now;
    record.updatedAt = now;
    collection.push(record);
    this.markDirty();
    return record;
  }

  insertMany(name, docs) {
    return docs.map((d) => this.insert(name, d));
  }

  update(name, id, patch) {
    const record = this.find(name, id);
    if (!record) return null;
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    this.markDirty();
    return record;
  }

  /** Xoá vĩnh viễn */
  remove(name, id) {
    const collection = this.all(name);
    const idx = collection.findIndex((d) => String(d.id) === String(id));
    if (idx === -1) return false;
    collection.splice(idx, 1);
    this.markDirty();
    return true;
  }

  /** Soft delete (đưa vào thùng rác) */
  softRemove(name, id, user) {
    const record = this.find(name, id);
    if (!record) return null;
    record.deletedAt = new Date().toISOString();
    record.deletedBy = user ? user.username : 'system';
    record.isDeleted = true;
    this.markDirty();
    return record;
  }

  restore(name, id) {
    const record = this.find(name, id);
    if (!record) return null;
    delete record.deletedAt;
    delete record.deletedBy;
    record.isDeleted = false;
    this.markDirty();
    return record;
  }

  count(name, predicate) {
    return predicate ? this.filter(name, predicate).length : this.all(name).length;
  }

  markDirty() {
    this._dirty = true;
    if (this._writeTimer) return;
    this._writeTimer = setTimeout(() => {
      this._writeTimer = null;
      this.flush();
    }, 250);
    if (this._writeTimer.unref) this._writeTimer.unref();
  }

  snapshot() {
    return { collections: this.collections, meta: this.meta, counters: this.counters, savedAt: new Date().toISOString() };
  }

  /** Ghi xuống đĩa an toàn */
  flush() {
    try {
      const payload = JSON.stringify(this.snapshot());
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, payload);
      fs.renameSync(tmp, DB_FILE);
      this._dirty = false;
      return true;
    } catch (e) {
      console.error('[store] Ghi CSDL thất bại:', e.message);
      return false;
    }
  }

  /** Tạo bản backup có timestamp, trả về tên file */
  backup(tag) {
    this.flush();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `db-${tag ? tag + '-' : ''}${stamp}.json`;
    const target = path.join(BACKUP_DIR, name);
    fs.copyFileSync(DB_FILE, target);
    this.meta.lastBackup = { file: name, at: new Date().toISOString() };
    this.markDirty();
    return name;
  }

  listBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { file: f, size: st.size, at: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  restoreBackup(file) {
    const src = path.join(BACKUP_DIR, path.basename(file));
    if (!fs.existsSync(src)) throw new Error('Không tìm thấy file backup: ' + file);
    const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
    this.collections = raw.collections || {};
    this.meta = raw.meta || {};
    this.counters = raw.counters || {};
    this.flush();
    return true;
  }

  /** Reset toàn bộ dữ liệu (dùng cho seed lại demo) */
  reset() {
    this.collections = {};
    this.meta = {};
    this.counters = {};
    this.flush();
  }

  /** Khoá bí mật ký token, sinh 1 lần và lưu trong data/ */
  secretKey() {
    const keyFile = path.join(DATA_DIR, '.secret.key');
    if (!fs.existsSync(keyFile)) {
      fs.writeFileSync(keyFile, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
    }
    return fs.readFileSync(keyFile, 'utf8').trim();
  }
}

module.exports = new Store();
