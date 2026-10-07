'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const data = window.RELICS_DATA;
  const model = window.SpireRelicModel.createModel(data.relics, data.gameVersion);
  const byId = new Map(data.relics.map(relic => [relic.id, relic]));
  const KEY = 'spire-relic-workspace-v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  let state = model.create(), unreadable = null, undo = [], redo = [], selected = null;
  let editingTier = null, pendingImport = null, previewUrl = null, drag = null, lastDrop = 0;
  let draftPool = new Set(), locked = new Set(), toastTimer;
  const defaultFilters = () => ({character: 'all', rarity: 'all', query: ''});
  let filters = defaultFilters(), catalogFilters = defaultFilters(), sort = 'manual';
  try {
    unreadable = localStorage.getItem(KEY);
    if (unreadable) state = model.validate(JSON.parse(unreadable));
    unreadable = null;
  } catch {
    warning('遗物存档无法读取，原数据已保留。当前显示空白排表；编辑时会先备份原数据。');
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function notify(message) {
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
  }
  function warning(message) {
    $('storage-warning').textContent = message;
    $('storage-warning').hidden = !message;
  }
  function save() {
    try {
      if (unreadable !== null) {
        localStorage.setItem(KEY + '-recovery-' + Date.now(), unreadable);
        unreadable = null;
      }
      localStorage.setItem(KEY, JSON.stringify(state));
      warning('');
      $('save-status').textContent = '已自动保存到本浏览器 · 遗物与卡牌存档独立 · 跨设备请导出 JSON';
    } catch {
      warning('自动保存失败，请导出 JSON 备份当前遗物排表。');
      $('save-status').textContent = '自动保存失败 · 请导出 JSON';
    }
  }
  function commit(next) {
    const valid = model.validate(next);
    if (JSON.stringify(valid) === JSON.stringify(state)) return false;
    undo.push(clone(state));
    if (undo.length > 100) undo.shift();
    redo = [];
    state = valid;
    save(); render();
    return true;
  }
  function travel(from, to) {
    if (!from.length) return;
    to.push(clone(state)); state = from.pop();
    save(); render();
  }
  function matches(relic, options) {
    return (options.character === 'all' || relic.character === options.character) &&
      (options.rarity === 'all' || relic.rarity === options.rarity) &&
      (!options.query || (relic.name + ' ' + relic.nameEn).toLocaleLowerCase().includes(options.query.toLocaleLowerCase().trim()));
  }
  function poolIds() {
    const ids = state.rows.pool.filter(id => matches(byId.get(id), filters));
    if (sort === 'name') ids.sort((a, b) => byId.get(a).name.localeCompare(byId.get(b).name, 'zh-CN'));
    if (sort === 'rarity') {
      const order = Object.keys(data.rarityLabels);
      ids.sort((a, b) => order.indexOf(byId.get(a).rarity) - order.indexOf(byId.get(b).rarity));
    }
    return ids;
  }
  function relicButton(id) {
    const relic = byId.get(id), button = element('button', 'relic-card');
    button.type = 'button'; button.draggable = true; button.dataset.id = id;
    button.title = relic.name + ' · ' + relic.rarityLabel + ' · ' + relic.characterLabel;
    button.setAttribute('aria-label', relic.name + '，查看详情或选择评级');
    const img = element('img');
    img.src = relic.image; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.width = 62; img.height = 62;
    button.append(img, element('span', '', relic.name));
    button.addEventListener('click', () => { if (Date.now() - lastDrop > 250) showDetail(id); });
    return button;
  }
  function renderZone(zone, ids, emptyText) {
    const content = document.createDocumentFragment();
    ids.forEach(id => content.append(relicButton(id)));
    if (!ids.length) content.append(element('span', 'zone-hint', emptyText));
    zone.replaceChildren(content);
  }
  function renderPool() {
    const ids = poolIds();
    $('pool-count').textContent = ids.length + ' / ' + state.rows.pool.length;
    renderZone($('pool'), ids, state.rows.pool.length ? '没有符合筛选条件的遗物' : '没有待排遗物，可在“选择遗物”中添加');
  }
  function render() {
    $('board-title').textContent = state.title;
    document.title = '尖塔排表 · ' + state.title;
    const ranked = state.tiers.reduce((n, tier) => n + state.rows[tier.id].length, 0);
    $('board-count').textContent = ranked + ' 件已评级 · ' + state.rows.pool.length + ' 件待排';
    $('undo').disabled = !undo.length; $('redo').disabled = !redo.length;
    $('add-tier').disabled = state.tiers.length >= 30;
    const board = document.createDocumentFragment();
    for (const tier of state.tiers) {
      const row = element('div', 'tier-row'), label = element('button', 'tier-label' + (tier.name.length > 3 ? ' long-label' : ''));
      label.type = 'button'; label.style.setProperty('--tier-color', tier.color);
      label.style.setProperty('--tier-ink', window.SpireRelicExport.contrast(tier.color));
      label.setAttribute('aria-label', '编辑评级 ' + tier.name);
      label.append(element('strong', '', tier.name), element('small', 'tier-edit-hint', '编辑'));
      label.addEventListener('click', () => showTier(tier.id));
      const zone = element('div', 'card-zone'); zone.dataset.tier = tier.id;
      zone.setAttribute('aria-label', tier.name + ' 档遗物');
      renderZone(zone, state.rows[tier.id], '拖入遗物，或点击遗物选择此档');
      row.append(label, zone); board.append(row);
    }
    $('tier-board').replaceChildren(board); renderPool();
  }
  function focusRelic(id) {
    const button = [...document.querySelectorAll('.relic-card')].find(node => node.dataset.id === id);
    button?.focus({preventScroll: true});
  }
  function showDetail(id) {
    selected = id;
    const relic = byId.get(id), inPool = state.rows.pool.includes(id);
    $('detail-name').textContent = relic.name; $('detail-english').textContent = relic.nameEn;
    $('detail-meta').textContent = relic.rarityLabel + ' · ' + relic.characterLabel + ' · ' + state.gameVersion;
    $('detail-description').textContent = relic.description || '该固定快照未提供效果说明。';
    $('detail-image').src = relic.image; $('detail-image').alt = relic.name;
    const moves = state.tiers.map(tier => {
      const button = element('button', '', tier.name);
      button.style.setProperty('--tier-color', tier.color);
      button.style.color = window.SpireRelicExport.contrast(tier.color);
      button.disabled = state.rows[tier.id].includes(id);
      button.addEventListener('click', () => { commit(model.move(state, id, tier.id)); $('relic-dialog').close(); focusRelic(id); });
      return button;
    });
    $('move-actions').replaceChildren(...moves);
    $('move-pool').disabled = inPool; $('remove-relic').hidden = !inPool;
    $('relic-dialog').showModal();
  }
  function showTier(id) {
    editingTier = id;
    const tier = state.tiers.find(item => item.id === id);
    $('tier-name').value = tier?.name || '新评级'; $('tier-color').value = tier?.color || '#b9db9d';
    $('tier-error').textContent = '';
    $('tier-dialog-title').textContent = tier ? '编辑评级' : '新增评级';
    $('delete-tier').hidden = !tier;
    $('delete-tier').disabled = state.tiers.length <= 1;
    $('tier-position').replaceChildren(...state.tiers.map((item, index) => new Option(String(index + 1), String(index))));
    if (!tier) $('tier-position').add(new Option(String(state.tiers.length + 1), String(state.tiers.length)));
    $('tier-position').value = String(tier ? state.tiers.indexOf(tier) : state.tiers.length);
    $('tier-dialog').showModal(); $('tier-name').focus();
  }
  function catalogMatches() { return data.relics.filter(relic => matches(relic, catalogFilters)); }
  function catalogCount() { $('catalog-selection').textContent = '选中 ' + (draftPool.size + locked.size) + ' 件（' + locked.size + ' 件已评级）'; }
  function renderCatalog() {
    const visible = catalogMatches();
    $('catalog-results').textContent = visible.length + ' 件遗物';
    const cards = visible.map(relic => {
      const isLocked = locked.has(relic.id), label = element('label', 'catalog-card' + (isLocked ? ' locked' : ''));
      const input = element('input'); input.type = 'checkbox'; input.checked = isLocked || draftPool.has(relic.id); input.disabled = isLocked;
      input.setAttribute('aria-label', relic.name + (isLocked ? '，已评级' : ''));
      input.addEventListener('change', () => { if (input.checked) draftPool.add(relic.id); else draftPool.delete(relic.id); catalogCount(); });
      const img = element('img'); img.src = relic.image; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.width = 64; img.height = 64;
      label.append(input, img, element('strong', '', relic.name), element('small', '', isLocked ? '已评级 · 保留' : relic.rarityLabel));
      return label;
    });
    $('catalog-grid').replaceChildren(...cards); catalogCount();
  }
  function populate(id, labels, all) {
    $(id).replaceChildren(new Option(all, 'all'), ...Object.entries(labels).map(([key, label]) => new Option(label, key)));
  }
  for (const prefix of ['filter', 'catalog']) {
    populate(prefix + '-character', data.characterLabels, '全部角色');
    populate(prefix + '-rarity', data.rarityLabels, '全部类别');
  }
  function connectFilters(prefix, getFilters, refresh) {
    for (const field of ['character', 'rarity']) $(prefix + '-' + field).addEventListener('change', event => { getFilters()[field] = event.target.value; refresh(); });
  }
  connectFilters('filter', () => filters, renderPool);
  connectFilters('catalog', () => catalogFilters, renderCatalog);
  $('search').addEventListener('input', event => { filters.query = event.target.value; renderPool(); });
  $('catalog-search').addEventListener('input', event => { catalogFilters.query = event.target.value; renderCatalog(); });
  $('pool-sort').addEventListener('change', event => { sort = event.target.value; renderPool(); });
  $('reset-filters').addEventListener('click', () => {
    filters = defaultFilters(); $('filter-character').value = 'all'; $('filter-rarity').value = 'all'; $('search').value = ''; renderPool();
  });
  $('manage-pool').addEventListener('click', () => {
    draftPool = new Set(state.rows.pool); locked = new Set(state.tiers.flatMap(tier => state.rows[tier.id]));
    catalogFilters = defaultFilters(); $('catalog-character').value = 'all'; $('catalog-rarity').value = 'all'; $('catalog-search').value = '';
    renderCatalog(); $('catalog-dialog').showModal();
  });
  $('catalog-select').addEventListener('click', () => { catalogMatches().forEach(relic => { if (!locked.has(relic.id)) draftPool.add(relic.id); }); renderCatalog(); });
  $('catalog-deselect').addEventListener('click', () => { catalogMatches().forEach(relic => draftPool.delete(relic.id)); renderCatalog(); });
  $('apply-catalog').addEventListener('click', () => { commit(model.setPool(state, [...draftPool])); $('catalog-dialog').close(); notify('遗物池已更新'); });
  $('move-pool').addEventListener('click', () => { commit(model.move(state, selected, 'pool')); $('relic-dialog').close(); focusRelic(selected); });
  $('remove-relic').addEventListener('click', () => {
    if (!state.rows.pool.includes(selected)) return;
    commit(model.setPool(state, state.rows.pool.filter(id => id !== selected))); $('relic-dialog').close(); notify('已移除，可撤销');
  });
  $('undo').addEventListener('click', () => travel(undo, redo));
  $('redo').addEventListener('click', () => travel(redo, undo));
  $('add-tier').addEventListener('click', () => showTier(null));
  $('auto-colors').addEventListener('click', () => {
    const colors = ['#ee9691', '#efbd87', '#efda88', '#b9db9d', '#8acf9b'];
    const next = clone(state);
    next.tiers.forEach((tier, i) => { tier.color = colors[Math.round(i * 4 / Math.max(1, next.tiers.length - 1))]; });
    commit(next);
  });
  $('edit-title').addEventListener('click', () => { $('title-input').value = state.title; $('title-error').textContent = ''; $('title-dialog').showModal(); $('title-input').select(); });
  $('title-form').addEventListener('submit', event => {
    event.preventDefault();
    try { commit({...state, title: $('title-input').value.trim()}); $('title-dialog').close(); }
    catch (error) { $('title-error').textContent = error.message; }
  });
  $('tier-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const patch = {name: $('tier-name').value.trim(), color: $('tier-color').value, position: Number($('tier-position').value)};
      let next;
      if (editingTier) next = model.updateTier(state, editingTier, patch);
      else { next = model.addTier(state, {name: patch.name, color: patch.color}); next = model.updateTier(next, next.tiers.at(-1).id, patch); }
      commit(next); $('tier-dialog').close();
    } catch (error) { $('tier-error').textContent = error.message; }
  });
  $('delete-tier').addEventListener('click', () => {
    try { commit(model.removeTier(state, editingTier)); $('tier-dialog').close(); notify('评级已删除，遗物移回待排区；可撤销'); }
    catch (error) { $('tier-error').textContent = error.message; }
  });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  document.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open]') || event.target.closest('input, textarea, select, [contenteditable=true]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? travel(redo, undo) : travel(undo, redo); }
  });
  function clearDropMarks() { document.querySelectorAll('.drag-over,.drop-before,.drop-after').forEach(node => node.classList.remove('drag-over', 'drop-before', 'drop-after')); }
  function stopDrag() { drag = null; clearDropMarks(); document.querySelectorAll('.dragging').forEach(node => node.classList.remove('dragging')); }
  document.addEventListener('dragstart', event => {
    const button = event.target.closest('.relic-card');
    if (!button) return;
    drag = {id: button.dataset.id, from: button.closest('[data-tier]').dataset.tier};
    event.dataTransfer.setData('text/plain', drag.id); event.dataTransfer.effectAllowed = 'move'; button.classList.add('dragging');
  });
  document.addEventListener('dragover', event => {
    if (!drag) return;
    const zone = event.target.closest('.card-zone'); clearDropMarks();
    if (!zone || (zone.dataset.tier === 'pool' && drag.from === 'pool' && sort !== 'manual')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; zone.classList.add('drag-over');
    const card = event.target.closest('.relic-card');
    if (card && card.dataset.id !== drag.id && !(zone.dataset.tier === 'pool' && sort !== 'manual')) {
      card.classList.add(event.clientX < card.getBoundingClientRect().left + card.offsetWidth / 2 ? 'drop-before' : 'drop-after');
    }
  });
  document.addEventListener('drop', event => {
    if (!drag) return;
    event.preventDefault();
    const zone = event.target.closest('.card-zone'), source = drag;
    if (zone && !(zone.dataset.tier === 'pool' && source.from === 'pool' && sort !== 'manual')) {
      const target = zone.dataset.tier, card = event.target.closest('.relic-card');
      let index;
      if (card && card.dataset.id === source.id) { stopDrag(); return; }
      if (card && !(target === 'pool' && sort !== 'manual')) {
        const after = event.clientX >= card.getBoundingClientRect().left + card.offsetWidth / 2;
        index = state.rows[target].filter(id => id !== source.id).indexOf(card.dataset.id) + (after ? 1 : 0);
      }
      try { commit(model.move(state, source.id, target, index)); } catch (error) { notify(error.message); }
    }
    lastDrop = Date.now(); stopDrag();
  });
  document.addEventListener('dragend', () => { lastDrop = Date.now(); stopDrag(); });
  window.addEventListener('blur', stopDrag);
  const fileName = () => (state.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 70) || '遗物排行');
  $('export-json').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], {type: 'application/json'}));
    const link = element('a'); link.href = url; link.download = fileName() + '.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  $('import-json').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; pendingImport = null;
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('JSON 文件超过 2 MB，请选择遗物排表文件。');
      pendingImport = model.validate(JSON.parse(await file.text()));
      const ranked = pendingImport.tiers.reduce((n, tier) => n + pendingImport.rows[tier.id].length, 0);
      $('import-summary').textContent = pendingImport.title + ' · ' + pendingImport.gameVersion + ' · ' + ranked + ' 件已评级 / ' + pendingImport.rows.pool.length + ' 件待排';
      $('import-dialog').showModal();
    } catch (error) { notify('导入失败：' + error.message); }
  });
  $('apply-import').addEventListener('click', () => { if (!pendingImport) return; commit(pendingImport); pendingImport = null; $('import-dialog').close(); notify('遗物排表已载入，可撤销'); });
  $('import-dialog').addEventListener('close', () => { pendingImport = null; });
  $('export-png').addEventListener('click', async () => {
    const snapshot = clone(state), name = fileName();
    $('export-png').disabled = true; $('export-png').textContent = '正在生成…';
    try {
      const result = await window.SpireRelicExport.render(snapshot, byId, Number($('export-resolution').value));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(result.blob);
      $('dialog-image').src = previewUrl; $('download-link').href = previewUrl; $('download-link').download = name + '.png'; $('download-link').hidden = false;
      $('dialog-caption').textContent = snapshot.title + ' · ' + result.width + ' × ' + result.height + ' px · 仅包含已评级遗物';
      $('image-dialog').showModal();
    } catch (error) { notify('导出失败：' + error.message); }
    finally { $('export-png').disabled = false; $('export-png').textContent = '↓ 导出 PNG'; }
  });
  window.addEventListener('storage', event => {
    if (event.key !== KEY || !event.newValue) return;
    try {
      const next = model.validate(JSON.parse(event.newValue));
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      stopDrag(); document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      state = next; unreadable = null; undo = []; redo = []; warning(''); render(); notify('已同步另一标签页的遗物工作区');
    } catch { warning('另一标签页的遗物存档无效，当前排表保持不变。'); }
  });
  $('relic-version').textContent = data.versionLabel + ' · ' + data.relics.length + ' 件';
  $('source-link').href = data.source.url;
  render();
})();
