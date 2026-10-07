'use strict';
((root) => {
  const KIND = 'spire-relic-tier-list';
  const RESERVED = new Set(['pool', '__proto__', 'constructor', 'prototype']);
  const DEFAULT_TIERS = Object.freeze([
    {id:'s', name:'S', color:'#ee9691'},
    {id:'a', name:'A', color:'#efbd87'},
    {id:'b', name:'B', color:'#efda88'},
    {id:'c', name:'C', color:'#b9db9d'},
    {id:'d', name:'D', color:'#8acf9b'}
  ].map(Object.freeze));
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  const validColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const validTierId = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/i.test(value) && !RESERVED.has(value);

  function createModel(relics, gameVersion = '0.111.0') {
    if (!Array.isArray(relics) || typeof gameVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(gameVersion)) {
      throw Error('遗物目录或游戏版本无效');
    }
    const ids = [], known = new Set();
    for (const relic of relics) {
      if (!isRecord(relic) || !validText(relic.id, 160) || known.has(relic.id)) throw Error('遗物目录 ID 无效或重复');
      ids.push(relic.id);
      known.add(relic.id);
    }

    function create() {
      const tiers = DEFAULT_TIERS.map(tier => ({...tier}));
      const rows = Object.fromEntries(tiers.map(tier => [tier.id, []]));
      rows.pool = [...ids];
      return {version:1, kind:KIND, gameVersion, title:'遗物排行', tiers, rows};
    }

    // Build a detached, known-shape document only after every row has passed validation.
    function validate(input) {
      if (!isRecord(input) || input.version !== 1 || input.kind !== KIND) throw Error('不是受支持的遗物排表文件');
      if (input.gameVersion !== gameVersion) throw Error('遗物排表的游戏版本不受支持');
      if (!validText(input.title, 80)) throw Error('排表标题须为 1–80 个字符');
      if (!Array.isArray(input.tiers) || input.tiers.length < 1 || input.tiers.length > 30) throw Error('评级数量须为 1–30 档');
      if (!isRecord(input.rows)) throw Error('遗物排表行数据无效');
      const tierIds = new Set(), tiers = [];
      for (const tier of input.tiers) {
        if (!isRecord(tier) || !validTierId(tier.id) || tierIds.has(tier.id)) throw Error('评级 ID 无效或重复');
        if (!validText(tier.name, 300)) throw Error('评级名称须为 1–300 个字符');
        if (!validColor(tier.color)) throw Error('评级颜色须为六位十六进制颜色');
        tierIds.add(tier.id);
        tiers.push({id:tier.id, name:tier.name, color:tier.color});
      }
      const expectedRows = [...tierIds, 'pool'];
      if (Object.keys(input.rows).length !== expectedRows.length || expectedRows.some(id => !own(input.rows, id))) {
        throw Error('遗物排表存在缺失或额外的行');
      }
      const rows = {}, used = new Set();
      for (const rowId of expectedRows) {
        const list = input.rows[rowId];
        if (!Array.isArray(list)) throw Error('遗物行必须为数组');
        const row = [];
        for (const id of list) {
          if (typeof id !== 'string' || !known.has(id)) throw Error('遗物 ID 不在当前目录中');
          if (used.has(id)) throw Error('同一遗物不能重复出现');
          used.add(id);
          row.push(id);
        }
        rows[rowId] = row;
      }
      return {version:1, kind:KIND, gameVersion, title:input.title, tiers, rows};
    }

    function move(state, id, target, index) {
      const next = validate(state);
      if (typeof id !== 'string' || !known.has(id)) throw Error('遗物不存在');
      if (typeof target !== 'string' || !own(next.rows, target)) throw Error('目标评级不存在');
      if (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) throw Error('插入位置无效');
      const source = Object.values(next.rows).find(row => row.includes(id));
      if (!source) throw Error('遗物尚未选入当前排表');
      source.splice(source.indexOf(id), 1);
      const destination = next.rows[target];
      // The index addresses the destination after removal, including moves inside one row.
      destination.splice(index === undefined ? destination.length : Math.min(index, destination.length), 0, id);
      return next;
    }

    function setPool(state, selectedIds) {
      const next = validate(state);
      if (!Array.isArray(selectedIds)) throw Error('待排遗物列表无效');
      const selected = new Set();
      for (const id of selectedIds) {
        if (typeof id !== 'string' || !known.has(id) || selected.has(id)) throw Error('待排遗物 ID 无效或重复');
        selected.add(id);
      }
      const ranked = new Set(next.tiers.flatMap(tier => next.rows[tier.id]));
      next.rows.pool = selectedIds.filter(id => !ranked.has(id));
      return next;
    }

    function updateTier(state, id, changes) {
      const next = validate(state), oldIndex = next.tiers.findIndex(tier => tier.id === id);
      if (oldIndex < 0) throw Error('评级不存在');
      if (!isRecord(changes) || Object.keys(changes).some(key => !['name', 'color', 'position'].includes(key))) throw Error('评级修改内容无效');
      const tier = next.tiers[oldIndex];
      if (own(changes, 'name')) tier.name = changes.name;
      if (own(changes, 'color')) tier.color = changes.color;
      if (own(changes, 'position')) {
        if (!Number.isInteger(changes.position) || changes.position < 0 || changes.position >= next.tiers.length) throw Error('评级位置无效');
        next.tiers.splice(oldIndex, 1);
        next.tiers.splice(changes.position, 0, tier);
      }
      return validate(next);
    }

    function removeTier(state, id) {
      const next = validate(state), index = next.tiers.findIndex(tier => tier.id === id);
      if (index < 0) throw Error('评级不存在');
      if (next.tiers.length === 1) throw Error('至少保留一个评级');
      next.rows.pool.push(...next.rows[id]);
      delete next.rows[id];
      next.tiers.splice(index, 1);
      return next;
    }

    function addTier(state, options = {}) {
      const next = validate(state);
      if (next.tiers.length >= 30) throw Error('最多可设置 30 个评级');
      if (!isRecord(options) || Object.keys(options).some(key => !['name', 'color'].includes(key))) throw Error('新增评级内容无效');
      let ordinal = 1;
      while (own(next.rows, 'tier-' + ordinal)) ordinal++;
      const tier = {id:'tier-' + ordinal, name:own(options, 'name') ? options.name : '新评级', color:own(options, 'color') ? options.color : '#a8bccd'};
      next.tiers.push(tier);
      next.rows[tier.id] = [];
      return validate(next);
    }

    return {create, validate, move, setPool, updateTier, removeTier, addTier};
  }

  const api = {createModel, DEFAULT_TIERS, KIND};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpireRelicModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
