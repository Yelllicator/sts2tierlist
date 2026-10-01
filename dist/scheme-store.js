/* IndexedDB snapshots are independent of the current workspace's autosave. */
'use strict';
((root) => {
  const DB_VERSION = 1, STORE = 'schemes';
  function problem(code, message, cause) {
    const error = new Error(message); error.name = 'SchemeStoreError'; error.code = code;
    if (cause) error.cause = cause;
    return error;
  }
  function storageProblem(error) {
    if (error?.name === 'SchemeStoreError') return error;
    switch (error?.name) {
      case 'QuotaExceededError': return problem('QUOTA', '本地存储空间不足，方案未保存。请导出备份并释放浏览器存储空间后重试。', error);
      case 'SecurityError': case 'NotAllowedError': return problem('UNAVAILABLE', '浏览器禁止使用本地方案库，请检查浏览器的存储权限。', error);
      case 'VersionError': return problem('VERSION_CHANGED', '本地方案库已由较新版本更新，请刷新页面或使用新版程序。', error);
      case 'AbortError': return problem('ABORTED', '本地方案操作已中止，请重试。', error);
      case 'DataCloneError': return problem('INVALID_BOARD', '方案包含无法保存的数据，请重新导入或保存。', error);
      case 'ConstraintError': return problem('CONFLICT', '方案编号发生冲突，未覆盖已有方案，请重试保存。', error);
      default: return problem('STORAGE_ERROR', '无法读写本地方案库，请重试；已有方案不会被自动清除。', error);
    }
  }
  function copyBoard(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem('INVALID_BOARD', '方案内容无效，请选择完整的排表方案。');
    try { return typeof root.structuredClone === 'function' ? root.structuredClone(value) : JSON.parse(JSON.stringify(value)); }
    catch (error) { throw problem('INVALID_BOARD', '方案内容无法复制，请检查导入文件。', error); }
  }
  function uuid() {
    if (typeof root.crypto?.randomUUID === 'function') return root.crypto.randomUUID();
    if (typeof root.crypto?.getRandomValues !== 'function') throw problem('UNAVAILABLE', '浏览器无法创建方案编号，请使用支持本地存储的现代浏览器。');
    const bytes = root.crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  function create(options = {}) {
    if (typeof options.validate !== 'function') throw problem('INVALID_CONFIG', '本地方案库缺少排表校验器。');
    const dbName = options.dbName === undefined ? 'spire-tier-schemes-v1' : options.dbName;
    if (typeof dbName !== 'string' || !dbName.trim()) throw problem('INVALID_CONFIG', '本地方案库名称无效。');
    let factory, accessError;
    try { factory = options.indexedDB === undefined ? root.indexedDB : options.indexedDB; }
    catch (error) { accessError = storageProblem(error); }
    let connection = null, opening = null, invalidated = null, lastTimestamp = 0;
    const timestamp = () => (lastTimestamp = Math.max(Date.now(), lastTimestamp + 1));
    function open() {
      if (invalidated) return Promise.reject(invalidated);
      if (accessError) return Promise.reject(accessError);
      if (!factory || typeof factory.open !== 'function') return Promise.reject(problem('UNAVAILABLE', '当前浏览器不支持或未启用 IndexedDB，本地方案库不可用。'));
      if (connection) return Promise.resolve(connection);
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        let request, settled = false, upgradeError;
        const fail = error => { if (!settled) { settled = true; reject(storageProblem(error)); } };
        try { request = factory.open(dbName, DB_VERSION); } catch (error) { fail(error); return; }
        request.onblocked = () => fail(problem('BLOCKED', '本地方案库被其他页面占用，请关闭其他排表页面后重试。'));
        request.onerror = () => fail(upgradeError || request.error);
        request.onupgradeneeded = () => {
          if (settled) { request.transaction.abort(); return; }
          try { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, {keyPath: 'id'}); }
          catch (error) { upgradeError = error; request.transaction.abort(); }
        };
        request.onsuccess = () => {
          const database = request.result;
          if (settled || invalidated) { database.close(); if (invalidated) fail(invalidated); return; }
          database.onversionchange = () => {
            invalidated = problem('VERSION_CHANGED', '本地方案库已在其他页面更新，请刷新页面后继续。');
            database.close(); if (connection === database) connection = null;
          };
          database.onclose = () => { if (connection === database) connection = null; };
          connection = database; settled = true; resolve(database);
        };
      }).then(database => { opening = null; return database; }, error => { opening = null; throw error; });
      return opening;
    }
    async function transact(mode, work) {
      const database = await open();
      if (invalidated) throw invalidated;
      return new Promise((resolve, reject) => {
        let transaction, value = null, failure = null;
        try { transaction = database.transaction(STORE, mode); } catch (error) { reject(storageProblem(error)); return; }
        const abort = error => {
          failure = storageProblem(error);
          try { transaction.abort(); } catch (_) { reject(failure); }
        };
        // A successful request can still be rolled back. Only oncomplete resolves.
        transaction.oncomplete = () => failure ? reject(failure) : resolve(value);
        transaction.onerror = event => { failure ||= storageProblem(event.target?.error || transaction.error); };
        transaction.onabort = () => reject(failure || storageProblem(transaction.error || {name: 'AbortError'}));
        const observe = (request, onSuccess) => {
          request.onerror = () => { failure = storageProblem(request.error); };
          request.onsuccess = () => { try { onSuccess(request.result); } catch (error) { abort(error); } };
        };
        try { work(transaction.objectStore(STORE), result => { value = result; }, observe); }
        catch (error) { abort(error); }
      });
    }
    function checkId(id) { if (typeof id !== 'string' || !id) throw problem('INVALID_ID', '方案编号无效。'); }
    async function validatedBoard(board) {
      const input = copyBoard(board);
      let checked;
      try { checked = await options.validate(input); }
      catch (error) { throw problem('INVALID_BOARD', error?.message || '排表方案未通过校验。', error); }
      if (checked === false || checked === null) throw problem('INVALID_BOARD', '排表方案未通过校验。');
      return copyBoard(checked === undefined || checked === true ? input : checked);
    }
    async function validatedRecord(record) {
      if (!record) return null;
      try { return {...record, board: await validatedBoard(record.board)}; }
      catch (error) { throw problem('CORRUPT_RECORD', `已存方案“${record.name || '未命名'}”无法通过校验：${error.message}`, error); }
    }
    async function save({name, board, preview = null} = {}) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw problem('INVALID_NAME', '方案名称需要 1–80 个字符。');
      if (preview !== null && (typeof root.Blob !== 'function' || !(preview instanceof root.Blob))) throw problem('INVALID_PREVIEW', '方案预览必须是图片 Blob。');
      const snapshot = await validatedBoard(board);
      const now = timestamp(), record = {id: uuid(), name: name.trim(), board: snapshot, preview, createdAt: now, updatedAt: now, deletedAt: null};
      return transact('readwrite', (store, set, observe) => { observe(store.add(record), () => set(record)); });
    }
    async function list({deleted = false} = {}) {
      const records = await transact('readonly', (store, set, observe) => observe(store.getAll(), records => {
        const field = deleted ? 'deletedAt' : 'createdAt';
        set(records.filter(record => (record.deletedAt != null) === !!deleted).sort((a,b) => b[field] - a[field] || b.createdAt - a.createdAt || b.id.localeCompare(a.id)));
      }));
      return Promise.all(records.map(validatedRecord));
    }
    async function get(id) {
      checkId(id);
      const record = await transact('readonly', (store, set, observe) => observe(store.get(id), record => set(record || null)));
      return validatedRecord(record);
    }
    async function setDeleted(id, deleted) {
      checkId(id);
      return transact('readwrite', (store, set, observe) => observe(store.get(id), record => {
        if (!record || (record.deletedAt != null) === deleted) { set(record || null); return; }
        const now = timestamp(), updated = {...record, updatedAt: now, deletedAt: deleted ? now : null};
        observe(store.put(updated), () => set(updated));
      }));
    }
    return {list, get, save, remove: id => setDeleted(id, true), restore: id => setDeleted(id, false)};
  }
  const api = {create};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SpireSchemeStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
