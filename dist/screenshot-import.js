/* Local screenshot review. The recognition worker and the application own their state. */
'use strict';
((root) => {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, action, className = '') => {
    const node = el('button', className, text); node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
  };
  const bounded = (value, min, max) => Math.max(min, Math.min(max, value));
  const validColor = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#d6c08a';
  const imageOf = card => card.thumbZh || card.imageZh || card.thumbEn || card.imageEn;
  async function rasterSize(file) {
    const data = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
    const view = new DataView(data.buffer);
    const ascii = (start, text) => [...text].every((letter, i) => data[start + i] === letter.charCodeAt(0));
    if (data.length >= 24 && data[0] === 137 && ascii(1, 'PNG\r\n\x1a\n')) return [view.getUint32(16), view.getUint32(20)];
    if (data.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
      for (let at = 12; at + 8 <= data.length;) {
        const size = view.getUint32(at + 4, true), start = at + 8;
        if (start + Math.min(size, 10) > data.length) break;
        if (ascii(at, 'VP8X') && size >= 10) return [1 + data[start + 4] + (data[start + 5] << 8) + (data[start + 6] << 16), 1 + data[start + 7] + (data[start + 8] << 8) + (data[start + 9] << 16)];
        if (ascii(at, 'VP8 ') && size >= 10 && data[start + 3] === 0x9d && data[start + 4] === 1 && data[start + 5] === 0x2a) return [view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff];
        if (ascii(at, 'VP8L') && size >= 5 && data[start] === 0x2f) {
          const bits = view.getUint32(start + 1, true); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
        }
        at = start + size + (size % 2);
      }
    }
    if (data[0] === 0xff && data[1] === 0xd8) {
      for (let at = 2; at + 3 < data.length;) {
        if (data[at++] !== 0xff) continue;
        while (at < data.length && data[at] === 0xff) at++;
        const marker = data[at++];
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
        if (at + 2 > data.length) break;
        const size = view.getUint16(at); if (size < 2 || at + size > data.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 7) return [view.getUint16(at + 5), view.getUint16(at + 3)];
        at += size;
      }
    }
    throw new Error('无法读取图片格式，请另存为 PNG、JPG 或 WebP 后重试');
  }

  function create({cards, getCards = () => cards, onApply}) {
    let byId = new Map(cards.map(card => [card.id, card]));
    let catalog = cards.slice().sort((a, b) => String(a.english || a.id).localeCompare(String(b.english || b.id)));
    let tiers = [], source = null, sourceUrl = null, selected = null, cropStart = null, cropRect = null;
    let cropping = false, zoom = false, controller = null, busy = false, applyBusy = false, revision = 0, serial = 0;
    let lastTier = null, editorTarget = null, returnFocus = null;
    const dialog = el('dialog', 'ssi-dialog');
    dialog.setAttribute('aria-labelledby', 'ssi-heading');
    const header = el('header', 'ssi-header');
    const headingWrap = el('div', 'ssi-heading-wrap');
    const heading = el('h2', '', '截图复原'); heading.id = 'ssi-heading';
    headingWrap.append(heading, el('span', 'ssi-local', '本机识别'));
    const closeButton = button('×', close, 'ssi-icon'); closeButton.setAttribute('aria-label', '关闭截图复原');
    header.append(headingWrap, closeButton);
    const file = el('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp'; file.hidden = true;
    const upload = button('选择截图', () => file.click());
    const titleLabel = el('label', 'ssi-title-label'); titleLabel.append(el('span', '', '标题'));
    const titleInput = el('input'); titleInput.type = 'text'; titleInput.maxLength = 80; titleInput.placeholder = '排表标题'; titleInput.setAttribute('aria-label', '复原排表标题');
    titleLabel.append(titleInput); titleInput.addEventListener('input', updateStatus);
    const tools = el('div', 'ssi-tools'); tools.append(upload, titleLabel, file);
    const status = el('div', 'ssi-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const statusText = el('span'); const cancel = button('取消识别', abort, 'quiet'); cancel.hidden = true;
    const progress = el('progress'); progress.max = 1; progress.value = 0; progress.hidden = true; progress.setAttribute('aria-label', '识别进度');
    status.append(statusText, progress, cancel);
    const blank = el('button', 'ssi-upload-area'); blank.type = 'button';
    blank.append(el('span', 'ssi-upload-icon', '↑'), el('strong', '', '点击或拖入截图'), el('span', '', 'PNG / JPG / WebP'));
    blank.addEventListener('click', () => file.click());
    const workspace = el('div', 'ssi-workspace'); workspace.hidden = true;
    const sourcePane = el('section', 'ssi-source-pane'); sourcePane.setAttribute('aria-label', '原始截图');
    const sourceToolbar = el('div', 'ssi-pane-heading');
    const cropButton = button('框选补牌', () => {
      cropping = !cropping; cropButton.setAttribute('aria-pressed', String(cropping));
      sourceStage.classList.toggle('ssi-cropping', cropping);
      sourceHelp.textContent = cropping ? '在原图拖出卡牌范围' : '';
    }); cropButton.setAttribute('aria-pressed', 'false');
    const zoomButton = button('放大', () => {
      zoom = !zoom; sourceStage.classList.toggle('ssi-zoomed', zoom); zoomButton.textContent = zoom ? '适应宽度' : '放大';
    });
    sourceToolbar.append(el('strong', '', '原图'), zoomButton, cropButton);
    const sourceHelp = el('p', 'ssi-source-help');
    const sourceScroll = el('div', 'ssi-source-scroll');
    const sourceStage = el('div', 'ssi-source-stage');
    const sourceImage = el('img'); sourceImage.alt = '待复原的 Tier List 截图'; sourceImage.draggable = false;
    const overlay = el('canvas', 'ssi-overlay'); overlay.setAttribute('aria-hidden', 'true');
    sourceStage.append(sourceImage, overlay); sourceScroll.append(sourceStage); sourcePane.append(sourceToolbar, sourceHelp, sourceScroll);
    const reviewPane = el('section', 'ssi-review-pane'); reviewPane.setAttribute('aria-label', '校对识别结果');
    const reviewToolbar = el('div', 'ssi-pane-heading');
    const addTier = button('＋ 评级', () => {
      if (tiers.length >= 24) return;
      const tier = {key: ++serial, name: '新评级', color: '#d6c08a', cards: []}; tiers.push(tier); lastTier = tier.key; renderTiers();
    });
    reviewToolbar.append(el('strong', '', '校对排表'), addTier);
    const tierList = el('div', 'ssi-tier-list'); reviewPane.append(reviewToolbar, tierList);
    workspace.append(sourcePane, reviewPane);
    const warnings = el('details', 'ssi-warnings'); warnings.hidden = true;
    const warningHeading = el('summary'); const warningList = el('ul'); warnings.append(warningHeading, warningList);
    const footer = el('footer', 'ssi-footer');
    const footerText = el('div'); const countText = el('span', 'ssi-count');
    const reviewSummary = el('div', 'ssi-review-summary');
    const pendingCards = button('', () => locatePending('card'), 'ssi-pending-link');
    const pendingNames = button('', () => locatePending('name'), 'ssi-pending-link');
    reviewSummary.append(pendingCards, pendingNames);
    footerText.append(countText, reviewSummary, el('small', '', '生成到「无预设」模板，可撤销'));
    const skip = button('跳过待处理', () => {
      const problems = getProblems();
      for (const tier of tiers) tier.cards = tier.cards.filter(item => !problems.items.has(item.key));
      if (selected && !findItem(selected)) selected = null;
      renderTiers();
    }); skip.hidden = true;
    const apply = button('生成排表', applyResult, 'primary'); apply.disabled = true;
    footer.append(footerText, skip, apply);
    dialog.append(header, tools, status, blank, workspace, warnings, footer);

    const editor = el('dialog', 'ssi-editor'); editor.setAttribute('aria-labelledby', 'ssi-editor-heading');
    const editHeader = el('header', 'ssi-header');
    const editHeading = el('h2', '', '校对卡牌'); editHeading.id = 'ssi-editor-heading';
    const editorClose = button('×', () => editor.close(), 'ssi-icon'); editorClose.setAttribute('aria-label', '关闭卡牌校对');
    editHeader.append(editHeading, editorClose);
    const editTop = el('div', 'ssi-edit-top');
    const sourceCrop = el('canvas', 'ssi-source-crop'); sourceCrop.setAttribute('aria-label', '截图中的卡牌');
    const editInfo = el('div', 'ssi-edit-info'); const editName = el('strong'); const editProblem = el('span', 'ssi-edit-problem');
    const tierSelect = el('select'); tierSelect.setAttribute('aria-label', '将卡牌移至评级');
    tierSelect.addEventListener('change', () => {
      const found = findItem(editorTarget), next = tiers.find(tier => String(tier.key) === tierSelect.value);
      if (!found || !next || found.tier === next) return;
      found.tier.cards.splice(found.index, 1); next.cards.push(found.item); lastTier = next.key; renderTiers(); renderEditor();
    });
    const editActions = el('div', 'ssi-edit-actions');
    const previous = button('← 前移', () => moveItem(-1)); const next = button('后移 →', () => moveItem(1));
    const remove = button('删除此格', () => {
      const found = findItem(editorTarget); if (found) found.tier.cards.splice(found.index, 1);
      selected = null; editor.close(); renderTiers();
    }, 'ssi-remove'); editActions.append(previous, next, remove);
    const confirm = button('确认这张卡', () => {
      const found = findItem(editorTarget); if (!found || !byId.has(found.item.id)) return;
      found.item.confirmed = true; renderTiers(); editor.close();
    }, 'primary');
    editInfo.append(editName, editProblem, tierSelect, editActions, confirm); editTop.append(sourceCrop, editInfo);
    const search = el('input', 'ssi-card-search'); search.type = 'search'; search.placeholder = '搜索中文名 / 英文名，替换此格'; search.setAttribute('aria-label', '搜索替换卡牌');
    search.addEventListener('input', renderCandidates);
    const candidateHeading = el('p', 'ssi-candidate-heading');
    const candidateGrid = el('div', 'ssi-candidates'); candidateGrid.setAttribute('aria-label', '候选卡牌');
    editor.append(editHeader, editTop, search, candidateHeading, candidateGrid);
    document.body.append(dialog, editor);

    function findItem(key) {
      for (const tier of tiers) {
        const index = tier.cards.findIndex(item => item.key === key);
        if (index >= 0) return {tier, index, item: tier.cards[index]};
      }
      return null;
    }
    function getProblems() {
      const frequency = new Map(), items = new Map();
      const flat = tiers.flatMap(tier => tier.cards);
      for (const item of flat) if (byId.has(item.id)) frequency.set(item.id, (frequency.get(item.id) || 0) + 1);
      for (const item of flat) {
        if (!byId.has(item.id)) items.set(item.key, '未识别');
        else if (frequency.get(item.id) > 1) items.set(item.key, '重复卡牌');
        else if (!item.confirmed) items.set(item.key, '待确认');
      }
      return {items, total: flat.length, invalidNames: tiers.some(tier => !tier.name.trim() || tier.name.trim().length > 300), nameReviews: tiers.filter(tier => tier.nameNeedsReview).length, emptyTitle: !titleInput.value.trim()};
    }
    function updateStatus() {
      const problems = getProblems();
      countText.textContent = tiers.length ? `${tiers.length} 档 · ${problems.total} 张` : '尚未导入截图';
      pendingCards.textContent = `! ${problems.items.size} 张待处理 →`;
      pendingCards.title = '定位待处理卡牌'; pendingCards.hidden = !problems.items.size;
      pendingNames.textContent = `! ${problems.nameReviews} 档文字待核对 →`;
      pendingNames.title = '定位待核对文字'; pendingNames.hidden = !problems.nameReviews;
      pendingCards.disabled = pendingNames.disabled = busy || applyBusy;
      reviewSummary.hidden = !problems.items.size && !problems.nameReviews;
      footer.classList.toggle('ssi-has-pending', !reviewSummary.hidden);
      skip.hidden = !problems.items.size; skip.disabled = busy || applyBusy;
      apply.disabled = busy || applyBusy || !tiers.length || !problems.total || !!problems.items.size || problems.invalidNames || problems.emptyTitle;
      apply.title = problems.items.size ? '请确认、替换或删除待处理卡牌' : problems.invalidNames ? '请填写每个评级名称（最多 300 字）' : problems.emptyTitle ? '请填写标题' : '';
      addTier.disabled = busy || tiers.length >= 24; cropButton.disabled = busy || !source;
      upload.disabled = applyBusy; titleInput.disabled = busy || applyBusy;
    }
    function locatePending(kind) {
      if (busy || applyBusy) return;
      let target, sourceBox;
      if (kind === 'name') {
        target = tierList.querySelector('.ssi-name-review');
        sourceBox = tiers.find(tier => tier.nameNeedsReview)?.labelBox;
      } else {
        const key = getProblems().items.keys().next().value;
        const found = findItem(key); if (!found) return;
        selected = key;
        for (const node of tierList.querySelectorAll('.ssi-review-card')) node.classList.toggle('ssi-selected', node.dataset.reviewKey === String(key));
        target = tierList.querySelector(`[data-review-key="${key}"]`);
        sourceBox = found.item.box;
        drawOverlay();
      }
      if (sourceBox && source) {
        const scale = sourceStage.clientWidth / source.width;
        sourceScroll.scrollTo({top: (sourceBox.y + sourceBox.height / 2) * scale - sourceScroll.clientHeight / 2 + 10, left: (sourceBox.x + sourceBox.width / 2) * scale - sourceScroll.clientWidth / 2 + 10});
      }
      target?.scrollIntoView({block: 'center', inline: 'nearest'});
      target?.focus({preventScroll: true});
    }
    function renderTiers() {
      const problems = getProblems(); tierList.replaceChildren();
      for (const [tierIndex, tier] of tiers.entries()) {
        const row = el('section', 'ssi-tier'); row.dataset.tierKey = String(tier.key);
        const rowHeader = el('div', 'ssi-tier-header');
        const color = el('input', 'ssi-tier-color'); color.type = 'color'; color.value = tier.color; color.disabled = busy; color.setAttribute('aria-label', `第${tierIndex + 1}档评级颜色`);
        color.addEventListener('input', () => { tier.color = color.value; drawOverlay(); });
        const nameField = el('div', 'ssi-name-field');
        const nameFlag = el('span', 'ssi-name-flag', '! 文字待核对'); nameFlag.hidden = !tier.nameNeedsReview;
        nameFlag.id = `ssi-name-review-${tier.key}`;
        const name = el('textarea', `ssi-tier-name${tier.nameNeedsReview ? ' ssi-name-review' : ''}`); name.value = tier.name; name.maxLength = 300; name.disabled = busy; name.rows = Math.min(6, Math.max(1, tier.name.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 26)), 0))); name.setAttribute('aria-label', `第${tierIndex + 1}档名称`);
        nameField.append(nameFlag, name);
        if (tier.nameNeedsReview) name.setAttribute('aria-describedby', nameFlag.id);
        name.title = tier.nameNeedsReview ? '识别文字可能不准确，请核对或直接修改' : '可编辑评级评价，最多 300 字';
        const confirmName = button('✓', () => { tier.nameNeedsReview = false; renderTiers(); }, 'ssi-icon ssi-name-confirm'); confirmName.hidden = !tier.nameNeedsReview; confirmName.disabled = busy; confirmName.title = '确认文字'; confirmName.setAttribute('aria-label', `确认第${tierIndex + 1}档文字`);
        name.addEventListener('input', () => { tier.name = name.value; tier.nameNeedsReview = false; name.classList.remove('ssi-name-review'); name.removeAttribute('aria-describedby'); nameFlag.hidden = true; confirmName.hidden = true; name.style.height = 'auto'; name.style.height = Math.min(220, Math.max(34, name.scrollHeight)) + 'px'; updateStatus(); });
        const up = button('↑', () => { [tiers[tierIndex - 1], tiers[tierIndex]] = [tiers[tierIndex], tiers[tierIndex - 1]]; renderTiers(); }, 'ssi-icon');
        up.disabled = busy || !tierIndex; up.setAttribute('aria-label', `上移第${tierIndex + 1}档`);
        const down = button('↓', () => { [tiers[tierIndex], tiers[tierIndex + 1]] = [tiers[tierIndex + 1], tiers[tierIndex]]; renderTiers(); }, 'ssi-icon');
        down.disabled = busy || tierIndex === tiers.length - 1; down.setAttribute('aria-label', `下移第${tierIndex + 1}档`);
        const removeTier = button('×', () => { tiers.splice(tierIndex, 1); if (!tiers.some(t => t.key === lastTier)) lastTier = tiers[0]?.key; renderTiers(); }, 'ssi-icon');
        removeTier.disabled = busy || tiers.length < 2; removeTier.setAttribute('aria-label', `删除第${tierIndex + 1}档及其中卡牌`); removeTier.title = '删除本档及其中卡牌';
        rowHeader.append(color, nameField, confirmName, el('span', 'ssi-tier-count', `${tier.cards.length}`), up, down, removeTier);
        const rowCards = el('div', 'ssi-row-cards');
        for (const item of tier.cards) {
          const card = byId.get(item.id), problem = problems.items.get(item.key);
          const cardButton = button('', () => { lastTier = tier.key; openEditor(item.key); }, `ssi-review-card${problem ? ' ssi-needs-review' : ''}${selected === item.key ? ' ssi-selected' : ''}`);
          cardButton.dataset.reviewKey = String(item.key);
          cardButton.setAttribute('aria-label', `${card?.name || '未识别卡牌'}${problem ? `，${problem}` : ''}，点击校对`);
          if (card) { const img = el('img'); img.src = imageOf(card); img.alt = ''; img.loading = 'lazy'; cardButton.append(img); }
          else { const placeholder = el('span', 'ssi-unknown'); placeholder.textContent = '?'; cardButton.append(placeholder); }
          cardButton.append(el('span', 'ssi-card-name', card?.name || '未识别'));
          if (problem || card?.unavailableInVersion) cardButton.append(el('small', 'ssi-card-badge', problem || '版本外'));
          rowCards.append(cardButton);
        }
        const add = button('＋ 卡牌', () => {
          const item = {key: ++serial, id: null, candidates: [], confidence: 0, confirmed: false, box: null}; tier.cards.push(item); lastTier = tier.key; renderTiers(); openEditor(item.key);
        }, 'ssi-add-card'); add.disabled = busy; rowCards.append(add);
        row.append(rowHeader, rowCards); tierList.append(row);
      }
      updateStatus(); drawOverlay();
    }
    function drawOverlay() {
      if (!source) return;
      if (overlay.width !== source.width || overlay.height !== source.height) { overlay.width = source.width; overlay.height = source.height; }
      const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, overlay.width, overlay.height);
      const problems = getProblems();
      const scale = source.width / Math.max(sourceStage.clientWidth, 1);
      for (const tier of tiers) for (const item of tier.cards) {
        if (!item.box) continue;
        const {x, y, width, height} = item.box;
        const pending = problems.items.has(item.key), isSelected = selected === item.key;
        ctx.lineWidth = Math.max(1.5, (pending || isSelected ? 3 : 1) * scale);
        ctx.strokeStyle = pending ? '#ffb45f' : isSelected ? '#fff0b8' : '#94ddab88';
        ctx.fillStyle = pending ? '#ff9b382e' : isSelected ? '#ffdd661f' : '#00000000';
        ctx.fillRect(x, y, width, height); ctx.strokeRect(x, y, width, height);
        if (pending) {
          const size = Math.min(16 * scale, width * .35, height * .35);
          ctx.fillStyle = '#ffb45f'; ctx.fillRect(x, y, size, size);
          ctx.fillStyle = '#2c1808'; ctx.font = `bold ${size * .8}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('!', x + size / 2, y + size / 2);
        }
      }
      if (cropRect) {
        ctx.strokeStyle = '#fff0b8'; ctx.fillStyle = '#dfc58b33'; ctx.setLineDash([6 * scale, 4 * scale]);
        ctx.fillRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height); ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height); ctx.setLineDash([]);
      }
    }
    function openEditor(key) {
      if (busy || !findItem(key)) return;
      selected = key; editorTarget = key; search.value = ''; renderTiers(); renderEditor();
      if (!editor.open) editor.showModal();
    }
    function renderEditor() {
      const found = findItem(editorTarget); if (!found) { editor.close(); return; }
      const card = byId.get(found.item.id); editName.textContent = card?.name || '选择对应卡牌';
      const problem = getProblems().items.get(found.item.key);
      editProblem.textContent = (problem ? [problem, found.item.reviewReason].filter(Boolean).join(' · ') : '已匹配')+(card?.unavailableInVersion?' · 此版本未收录，卡面来自 '+card.gameVersion:'');
      confirm.disabled = !card; tierSelect.replaceChildren();
      for (const tier of tiers) { const option = el('option', '', tier.name); option.value = String(tier.key); tierSelect.append(option); }
      tierSelect.value = String(found.tier.key);
      previous.disabled = found.index === 0; next.disabled = found.index === found.tier.cards.length - 1;
      const box = found.item.box; sourceCrop.hidden = !source || !box;
      if (source && box) {
        const ratio = Math.min(1, 420 / Math.max(box.width, box.height));
        sourceCrop.width = Math.max(1, Math.round(box.width * ratio)); sourceCrop.height = Math.max(1, Math.round(box.height * ratio));
        sourceCrop.getContext('2d').drawImage(source, box.x, box.y, box.width, box.height, 0, 0, sourceCrop.width, sourceCrop.height);
      }
      renderCandidates();
    }
    function renderCandidates() {
      const found = findItem(editorTarget); if (!found) return;
      const query = search.value.trim().toLowerCase();
      const candidates = (found.item.candidates || []).filter(candidate => byId.has(candidate.id));
      const suggested = !query && candidates.length;
      const list = suggested ? [...new Set(candidates.map(candidate => candidate.id))].map(id => byId.get(id)) : catalog.filter(card => !query || `${card.name} ${card.english} ${card.id}`.toLowerCase().includes(query));
      candidateHeading.textContent = suggested ? '候选卡牌 · 点击替换并确认' : `${list.length} 张卡牌 · 点击选择`;
      candidateGrid.replaceChildren();
      if (!list.length) candidateGrid.append(el('p', 'ssi-no-results', '没有找到卡牌'));
      for (const card of list) {
        const pick = button('', () => {
          const current = findItem(editorTarget); if (!current) return;
          current.item.id = card.id; current.item.confirmed = true; renderTiers(); editor.close();
        }, 'ssi-candidate');
        pick.setAttribute('aria-label', `选择${card.name}`);
        if (card.id === found.item.id) pick.classList.add('ssi-current');
        const img = el('img'); img.src = imageOf(card); img.alt = ''; img.loading = 'lazy';
        pick.append(img, el('span', '', card.name+(card.unavailableInVersion?' · 版本外':''))); candidateGrid.append(pick);
      }
    }
    function moveItem(delta) {
      const found = findItem(editorTarget); if (!found) return;
      const target = found.index + delta;
      if (target < 0 || target >= found.tier.cards.length) return;
      [found.tier.cards[found.index], found.tier.cards[target]] = [found.tier.cards[target], found.tier.cards[found.index]];
      renderTiers(); renderEditor();
    }
    function point(event) {
      const box = overlay.getBoundingClientRect();
      return {x: bounded((event.clientX - box.left) * source.width / box.width, 0, source.width), y: bounded((event.clientY - box.top) * source.height / box.height, 0, source.height)};
    }
    overlay.addEventListener('pointerdown', event => {
      if (!source || busy || event.button !== 0) return;
      const p = point(event);
      if (cropping) { event.preventDefault(); cropStart = p; cropRect = null; overlay.setPointerCapture(event.pointerId); return; }
      for (const tier of tiers) for (const item of tier.cards) {
        const b = item.box;
        if (b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) { lastTier = tier.key; openEditor(item.key); return; }
      }
    });
    overlay.addEventListener('pointermove', event => {
      if (!cropStart) return;
      const p = point(event); cropRect = {x: Math.min(p.x, cropStart.x), y: Math.min(p.y, cropStart.y), width: Math.abs(p.x - cropStart.x), height: Math.abs(p.y - cropStart.y)}; drawOverlay();
    });
    overlay.addEventListener('pointerup', event => {
      if (!cropStart) return;
      if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
      const box = cropRect; cropStart = null; cropRect = null;
      if (box && box.width >= 8 && box.height >= 8) {
        let tier = tiers.find(value => value.key === lastTier) || tiers[0];
        if (!tier) { tier = {key: ++serial, name: '档位 1', color: '#d6c08a', cards: []}; tiers.push(tier); }
        const item = {key: ++serial, id: null, candidates: [], confidence: 0, confirmed: false, box}; tier.cards.push(item);
        cropping = false; cropButton.setAttribute('aria-pressed', 'false'); sourceStage.classList.remove('ssi-cropping'); sourceHelp.textContent = ''; renderTiers(); openEditor(item.key);
      } else drawOverlay();
    });
    overlay.addEventListener('pointercancel', () => { cropStart = null; cropRect = null; drawOverlay(); });

    async function loadFile(chosen) {
      if (!chosen || applyBusy) return;
      if (!/^image\/(png|jpeg|webp)$/i.test(chosen.type) && !/\.(png|jpe?g|webp)$/i.test(chosen.name)) { statusText.textContent = '请选择 PNG、JPG 或 WebP 图片'; return; }
      if (chosen.size > 40 * 1024 * 1024) { statusText.textContent = '图片过大，请使用 40 MB 以内的截图'; return; }
      abort(false); const thisRevision = ++revision; busy = true; controller = new AbortController();
      const signal = controller.signal;
      cancel.hidden = false; progress.hidden = false; progress.value = 0; statusText.textContent = '读取截图…';
      updateStatus();
      let objectUrl = null, bitmap = null;
      try {
        const [width, height] = await rasterSize(chosen);
        if (!width || !height || width * height > 96000000 || Math.max(width, height) > 30000) throw new Error('图片尺寸过大，请先裁掉无关区域（最多 9600 万像素）');
        if (signal.aborted || thisRevision !== revision) return;
        const scale = Math.min(1, 2400 / Math.max(width, height));
        const targetWidth = Math.max(1, Math.round(width * scale)), targetHeight = Math.max(1, Math.round(height * scale));
        if (typeof createImageBitmap !== 'function') throw new Error('请使用新版 Edge 或 Chrome 浏览器导入截图');
        bitmap = await createImageBitmap(chosen, {resizeWidth: targetWidth, resizeHeight: targetHeight, resizeQuality: 'high'});
        if (signal.aborted || thisRevision !== revision) return;
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', {willReadFrequently: true}); ctx.drawImage(bitmap, 0, 0); bitmap.close(); bitmap = null;
        const previewBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (signal.aborted || thisRevision !== revision) return;
        if (!previewBlob) throw new Error('截图预览生成失败，请重试');
        objectUrl = URL.createObjectURL(previewBlob);
        source = canvas;
        if (sourceUrl) URL.revokeObjectURL(sourceUrl);
        sourceUrl = objectUrl; objectUrl = null; sourceImage.src = sourceUrl;
        sourceStage.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
        zoom = false; sourceStage.classList.remove('ssi-zoomed'); zoomButton.textContent = '放大';
        sourceScroll.scrollTo(0, 0); selected = null; tiers = []; tierList.replaceChildren(); drawOverlay();
        titleInput.value = chosen.name.replace(/\.[^.]+$/, '').slice(0, 70) + ' · 复原';
        blank.hidden = true; workspace.hidden = false; warnings.hidden = true;
        if (!root.SpireScreenshotEngine?.analyze) throw new Error('识别组件未加载，请刷新页面后重试');
        const result = await root.SpireScreenshotEngine.analyze(ctx.getImageData(0, 0, canvas.width, canvas.height), {
          signal,
          onProgress(value) {
            if (signal.aborted || thisRevision !== revision) return;
            const amount = typeof value === 'number' ? value : value?.progress;
            if (Number.isFinite(amount)) progress.value = bounded(amount > 1 ? amount / 100 : amount, 0, 1) * 0.65;
            const phaseNames = {loading: '载入本地图库…', detect: '定位评级与卡牌…', matching: '匹配卡牌…', match: '匹配卡牌…', prepare: '准备识别…', finalize: '整理识别结果…'};
            statusText.textContent = value?.message || phaseNames[value?.phase] || `正在识别… ${Math.round(progress.value * 100)}%`;
          }
        });
        if (signal.aborted || thisRevision !== revision) return;
        const ratioX = canvas.width / (result.width || canvas.width), ratioY = canvas.height / (result.height || canvas.height);
        tiers = (result.tiers || []).slice(0, 24).map((tier, i) => ({
          key: ++serial, name: String(tier.name || `档位 ${i + 1}`), nameNeedsReview: true, color: validColor(tier.color),
          labelBox: tier.labelBox ? {x: tier.labelBox.x * ratioX, y: tier.labelBox.y * ratioY, width: tier.labelBox.width * ratioX, height: tier.labelBox.height * ratioY} : null,
          cards: (tier.cards || []).slice(0, cards.length).map(item => {
            const candidates = (item.candidates || []).filter(candidate => byId.has(candidate.id)).slice(0, 8);
            const id = byId.has(item.id) ? item.id : null;
            const confidence = Number.isFinite(item.confidence) ? item.confidence : 0;
            const uncertain = item.needsReview === true || confidence < 0.72 || (candidates.length > 1 && candidates[0].score - candidates[1].score < 0.03);
            const box = item.box ? {x: item.box.x * ratioX, y: item.box.y * ratioY, width: item.box.width * ratioX, height: item.box.height * ratioY} : null;
            const reviewReason = typeof item.reviewReason === 'string' ? item.reviewReason.slice(0, 120) : item.clipped ? '卡面被截图边缘截断，请核对' : '';
            return {key: ++serial, id, candidates, confidence, confirmed: !!id && !uncertain, box, reviewReason};
          })
        }));
        if (!tiers.length) tiers.push({key: ++serial, name: '档位 1', color: '#d6c08a', cards: []});
        lastTier = tiers[0].key;
        const notes = (result.warnings || []).filter(note => !String(note).startsWith('评级名称需要手动填写'));
        if ((result.tiers || []).length > 24) notes.push('最多导入 24 档，超出部分未保留');
        renderTiers();
        if (result.tiers?.length) {
          statusText.textContent = '识别左侧评级文字…';
          try {
            if (!root.SpireScreenshotOCR?.recognize) throw new Error('文字识别组件未加载，请刷新页面后重试');
            const textResult = await root.SpireScreenshotOCR.recognize(canvas, result.tiers.slice(0, 24), {
              signal,
              original: {blob: chosen, width, height, analysisWidth: result.width || canvas.width, analysisHeight: result.height || canvas.height},
              onProgress(value) {
                if (signal.aborted || thisRevision !== revision) return;
                const amount = typeof value === 'number' ? value : value?.progress;
                if (Number.isFinite(amount)) progress.value = 0.65 + 0.35 * bounded(amount > 1 ? amount / 100 : amount, 0, 1);
                statusText.textContent = value?.message || '识别左侧评级文字…';
              }
            });
            if (signal.aborted || thisRevision !== revision) return;
            for (const [i, tier] of tiers.entries()) {
              const label = textResult.labels?.[i];
              const text = String(label?.text || '').replace(/\r\n?/g, '\n').trim();
              if (text) tier.name = text;
              tier.nameNeedsReview = !text || label?.needsReview === true || text.length > 300;
              if (text.length > 300) notes.push(`第 ${i + 1} 档文字超过 300 字，请缩短后生成`);
            }
            notes.push(...(textResult.warnings || []));
          } catch (error) {
            if (signal.aborted || thisRevision !== revision) return;
            for (const tier of tiers) tier.nameNeedsReview = true;
            notes.push(`${error?.message || '文字识别失败'}；卡牌结果已保留，可手动填写评级文字`);
          }
        }
        warningList.replaceChildren(); for (const note of notes) warningList.append(el('li', '', String(note)));
        warningHeading.textContent = `识别提示（${notes.length}）`; warnings.hidden = !notes.length;
        statusText.textContent = tiers.some(tier => tier.cards.length) ? '识别完成 · 点击卡牌校对，档名可编辑' : '未定位到卡牌，可框选补牌或手动添加';
      } catch (error) {
        if (signal.aborted || thisRevision !== revision) return;
        statusText.textContent = error?.message || '截图无法读取，请换一张图片重试';
        if (source && !tiers.length) { tiers = [{key: ++serial, name: '档位 1', color: '#d6c08a', cards: []}]; lastTier = tiers[0].key; }
      } finally {
        bitmap?.close();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (thisRevision === revision) { busy = false; controller = null; cancel.hidden = true; progress.hidden = true; renderTiers(); }
      }
    }
    function abort(showMessage = true) {
      if (!busy) return;
      controller?.abort(); controller = null; ++revision; busy = false;
      cancel.hidden = true; progress.hidden = true;
      statusText.textContent = '已取消识别';
      if (showMessage) {
        if (source && !tiers.length) { tiers = [{key: ++serial, name: '档位 1', color: '#d6c08a', cards: []}]; lastTier = tiers[0].key; }
      }
      renderTiers();
    }
    async function applyResult() {
      updateStatus(); if (apply.disabled) return;
      const result = {title: titleInput.value.trim(), tiers: tiers.map(tier => ({name: tier.name.trim(), color: tier.color, cards: tier.cards.map(item => item.id)}))};
      applyBusy = true; updateStatus(); apply.textContent = '正在生成…';
      try { await onApply(result); close(); }
      catch (error) { statusText.textContent = error?.message || '未能生成排表，请重试'; }
      finally { applyBusy = false; apply.textContent = '生成排表'; updateStatus(); }
    }
    function open(options = {}) {
      const current = new Map(cards.map(card => [card.id, {...card, unavailableInVersion: true}]));
      for (const card of getCards()) current.set(card.id, card);
      byId = current;
      catalog = [...current.values()].sort((a, b) => String(a.english || a.id).localeCompare(String(b.english || b.id)));
      if (dialog.open) return;
      returnFocus = document.activeElement;
      if (!source && options.title) titleInput.value = String(options.title).slice(0, 80);
      dialog.showModal(); updateStatus();
    }
    function close() {
      abort(false); if (editor.open) editor.close(); if (dialog.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    }
    file.addEventListener('change', () => { const chosen = file.files[0]; file.value = ''; loadFile(chosen); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); blank.classList.add('ssi-drag-over'); } });
    dialog.addEventListener('dragleave', event => { if (!dialog.contains(event.relatedTarget)) blank.classList.remove('ssi-drag-over'); });
    dialog.addEventListener('drop', event => { if (!event.dataTransfer?.files.length) return; event.preventDefault(); blank.classList.remove('ssi-drag-over'); loadFile(event.dataTransfer.files[0]); });
    editor.addEventListener('close', () => { editorTarget = null; });
    const resizeObserver = new ResizeObserver(() => drawOverlay()); resizeObserver.observe(sourceStage);
    updateStatus();
    return {open, close};
  }
  root.SpireScreenshotImporter = {create};
})(window);
