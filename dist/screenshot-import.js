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
  function sortCatalog(cards) {
    const {compareCards, sortPool} = root.SpireBoardModel;
    const byId = new Map(cards.map(card => [card.id, card])), groups = new Map();
    // Seed equal sort values with the model's deterministic English-name order.
    for (const card of cards.slice().sort(compareCards)) {
      const color = card.color || 'silent';
      if (!groups.has(color)) groups.set(color, []);
      groups.get(color).push(card.id);
    }
    const colors = [...groups.keys()].sort((left, right) => compareCards({id: left, color: left}, {id: right, color: right}));
    const settings = ['rarity', 'type', 'cost'].map(key => ({key, direction: 'desc'}));
    return colors.flatMap(color => sortPool(groups.get(color), byId, settings)).map(id => byId.get(id));
  }
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

  function create({cards, getCards = () => cards, getLanguage = () => 'zh', onApply}) {
    let byId = new Map(cards.map(card => [card.id, card]));
    let catalog = sortCatalog(cards), rememberedColorFilter = '';
    let tiers = [], source = null, sourceUrl = null, selected = null, cropStart = null, cropRect = null;
    let cropping = false, zoom = 100, controller = null, busy = false, applyBusy = false, revision = 0, serial = 0;
    let lastTier = null, editorTarget = null, editorSession = null, returnFocus = null;
    let selectionMode = 'card', selectionTool = 'add', gesture = null;
    let tierLayout = null, pendingLayout = null, originalImage = null;
    let batchKind = null, batchReturnFocus = null, nameEditorKey = null;
    const batchSelection = new Set();
    const dialog = el('dialog', 'ssi-dialog');
    dialog.setAttribute('aria-labelledby', 'ssi-heading');
    const header = el('header', 'ssi-header');
    const headingWrap = el('div', 'ssi-heading-wrap');
    const heading = el('h2', '', '截图复原'); heading.id = 'ssi-heading';
    headingWrap.append(heading);
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
    const cropButton = button('手动调整', () => { cropping = !cropping; resetGesture(); renderSelectionTools(); }); cropButton.setAttribute('aria-pressed', 'false');
    const zoomLabel = el('label', 'ssi-zoom-control'); zoomLabel.append(el('span', '', '缩放'));
    const zoomSlider = el('input'); zoomSlider.type = 'range'; zoomSlider.min = '50'; zoomSlider.max = '400'; zoomSlider.step = '5'; zoomSlider.value = '100'; zoomSlider.setAttribute('aria-label', '原图缩放，100% 为适应宽度');
    const zoomValue = el('output', '', '100%'); zoomSlider.addEventListener('input', () => setZoom(Number(zoomSlider.value)));
    zoomLabel.append(zoomSlider, zoomValue);
    sourceToolbar.append(el('strong', '', '原图'), zoomLabel, cropButton);
    const selectionToolbar = el('div', 'ssi-selection-toolbar'); selectionToolbar.hidden = true;
    const cardMode = button('卡牌范围', () => { selectionMode = 'card'; resetGesture(); renderSelectionTools(); });
    const tierMode = button('评级分隔线', () => { selectionMode = 'tier'; resetGesture(); renderSelectionTools(); });
    const addBoxTool = button('', () => { selectionTool = 'add'; renderSelectionTools(); }, 'ssi-selection-icon');
    const eraseTool = button('', () => { selectionTool = 'erase'; renderSelectionTools(); }, 'ssi-selection-icon');
    for (const [tool, name, path] of [[addBoxTool, '新增框', 'M4 4h16v16H4z M12 8v8 M8 12h8'], [eraseTool, '橡皮擦', 'M4 14 14 4l7 7-9 9H9z M8 10l7 7 M12 20h9']]) {
      tool.setAttribute('aria-label', name);
      const icon = el('img'); icon.alt = ''; icon.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e9c699" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`); tool.append(icon);
    }
    addBoxTool.title = '默认左键拖动新增'; eraseTool.title = '右键点击或拖动擦除；选中后也可用左键';
    const selectionActions = el('div', 'ssi-selection-actions'); selectionActions.append(addBoxTool, eraseTool);
    const selectionModes = el('div', 'ssi-selection-modes'); selectionModes.append(tierMode, cardMode);
    selectionToolbar.append(selectionActions, selectionModes);
    const sourceScroll = el('div', 'ssi-source-scroll');
    const sourceStage = el('div', 'ssi-source-stage');
    const sourceImage = el('img'); sourceImage.alt = '待复原的 Tier List 截图'; sourceImage.draggable = false;
    const overlay = el('canvas', 'ssi-overlay'); overlay.setAttribute('aria-hidden', 'true');
    sourceStage.append(sourceImage, overlay); sourceScroll.append(sourceStage); sourcePane.append(sourceToolbar, selectionToolbar, sourceScroll);
    const hoverPanel = el('div', 'ssi-hover-preview'); hoverPanel.hidden = true; hoverPanel.setAttribute('role', 'tooltip');
    const hoverTitle = el('strong', 'ssi-hover-title'), hoverNote = el('span', 'ssi-hover-note');
    const hoverComparison = el('div', 'ssi-hover-comparison');
    const hoverOriginal = el('div'), hoverRecognized = el('div');
    const hoverCrop = el('canvas'), hoverImage = el('img'), hoverUnknown = el('span', 'ssi-hover-unknown', '尚未识别');
    hoverImage.alt = '已识别到的卡牌';
    hoverOriginal.append(el('span', '', '原图裁切'), hoverCrop); hoverRecognized.append(el('span', '', '识别结果'), hoverImage, hoverUnknown);
    hoverComparison.append(hoverOriginal, hoverRecognized); hoverPanel.append(hoverTitle, hoverNote, hoverComparison);
    let hoverKey = null;
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
    const criticalCards = button('', () => openBatch('critical'), 'ssi-pending-link ssi-pending-critical');
    const pendingCards = button('', () => openBatch('severe'), 'ssi-pending-link ssi-pending-severe');
    const moderateCards = button('', () => openBatch('moderate'), 'ssi-pending-link ssi-pending-moderate');
    const pendingNames = button('', () => openBatch('name'), 'ssi-pending-link ssi-pending-names');
    reviewSummary.append(criticalCards, pendingCards, moderateCards, pendingNames);
    footerText.append(countText, reviewSummary);
    const apply = button('生成排表', applyResult, 'primary'); apply.disabled = true;
    const applyNote = el('small', 'ssi-apply-note'); footerText.append(applyNote);
    footer.append(footerText, apply);
    dialog.append(header, tools, status, blank, workspace, warnings, footer, hoverPanel);

    const editor = el('dialog', 'ssi-editor'); editor.setAttribute('aria-labelledby', 'ssi-editor-heading');
    const editHeader = el('header', 'ssi-header');
    const editHeading = el('h2', '', '校对卡牌'); editHeading.id = 'ssi-editor-heading';
    const editorClose = button('×', cancelEditor, 'ssi-icon'); editorClose.setAttribute('aria-label', '取消卡牌校对');
    editHeader.append(editHeading, editorClose);
    const editTop = el('div', 'ssi-edit-top');
    const sourceCrop = el('canvas', 'ssi-source-crop'); sourceCrop.setAttribute('aria-label', '截图中的卡牌');
    const editInfo = el('div', 'ssi-edit-info'); const editName = el('strong'); const editProblem = el('span', 'ssi-edit-problem');
    const tierSelect = el('select'); tierSelect.setAttribute('aria-label', '所属评级');
    const tierLabel = el('label', 'ssi-editor-tier'); tierLabel.append(el('span', '', '所属评级'), tierSelect);
    tierSelect.addEventListener('change', () => { if (editorSession) editorSession.tierKey = Number(tierSelect.value); });
    const remove = button('删除卡牌', () => {
      const found = findItem(editorTarget); if (found) found.tier.cards.splice(found.index, 1);
      selected = null; finishEditor(); renderTiers();
    }, 'ssi-remove');
    const confirm = button('确认', confirmEditor, 'primary');
    const editorCancel = button('取消', cancelEditor);
    const editorFooter = el('footer', 'ssi-editor-footer'); editorFooter.append(remove, editorCancel, confirm);
    const editSource = el('div', 'ssi-edit-source');
    editInfo.append(editName, editProblem, tierLabel); editSource.append(sourceCrop, editInfo);
    const recommendations = el('section', 'ssi-recommendations'); recommendations.setAttribute('aria-label', '优先推荐候选');
    const recommendationHeading = el('h3', 'ssi-recommendation-heading', '优先推荐候选');
    const recommendationHint = el('p', 'ssi-recommendation-hint', '单击预选，双击确认');
    const recommendationGrid = el('div', 'ssi-recommended-cards'); recommendationGrid.setAttribute('aria-label', '优先推荐卡牌');
    recommendations.append(recommendationHeading, recommendationHint, recommendationGrid); editTop.append(editSource, recommendations);
    const search = el('input', 'ssi-card-search'); search.type = 'search'; search.placeholder = '搜索中文名 / 英文名'; search.setAttribute('aria-label', '搜索替换卡牌');
    search.addEventListener('input', renderCandidates);
    const filterBar = el('div', 'ssi-card-filters');
    const colorFilter = el('select'); colorFilter.setAttribute('aria-label', '筛选职业或颜色');
    const rarityFilter = el('select'); rarityFilter.setAttribute('aria-label', '筛选卡牌稀有度');
    const typeFilter = el('select'); typeFilter.setAttribute('aria-label', '筛选卡牌类型');
    const costFilter = el('select'); costFilter.setAttribute('aria-label', '筛选卡牌费用');
    const clearFilters = button('清除筛选', () => { search.value = ''; rememberedColorFilter = ''; for (const field of [colorFilter, rarityFilter, typeFilter, costFilter]) field.value = ''; renderCandidates(); });
    colorFilter.addEventListener('change', () => { rememberedColorFilter = colorFilter.value; renderCandidates(); });
    for (const field of [rarityFilter, typeFilter, costFilter]) field.addEventListener('change', renderCandidates);
    filterBar.append(colorFilter, rarityFilter, typeFilter, costFilter, clearFilters);
    const candidateHeading = el('p', 'ssi-candidate-heading');
    const candidateGrid = el('div', 'ssi-candidates'); candidateGrid.setAttribute('aria-label', '完整卡库');
    const catalogPanel = el('section', 'ssi-catalog-panel'); catalogPanel.setAttribute('aria-labelledby', 'ssi-catalog-prompt');
    const catalogPrompt = el('h3', 'ssi-catalog-prompt'); catalogPrompt.id = 'ssi-catalog-prompt';
    catalogPanel.append(catalogPrompt, search, filterBar, candidateHeading, candidateGrid);
    editor.append(editHeader, editTop, catalogPanel, editorFooter);
    const batchDialog = el('dialog', 'ssi-batch-dialog'); batchDialog.setAttribute('aria-labelledby', 'ssi-batch-heading');
    const batchHeader = el('header', 'ssi-header');
    const batchHeading = el('h2'); batchHeading.id = 'ssi-batch-heading';
    const batchClose = button('×', closeBatch, 'ssi-icon'); batchClose.setAttribute('aria-label', '关闭批量核对');
    batchHeader.append(batchHeading, batchClose);
    const batchHelp = el('p', 'ssi-batch-help');
    const batchList = el('div', 'ssi-batch-list'); batchList.setAttribute('aria-label', '待核对对比列表');
    const batchFooter = el('footer', 'ssi-batch-footer');
    const batchCount = el('span', 'ssi-batch-count'); batchCount.setAttribute('aria-live', 'polite');
    const batchAll = button('全选', () => { for (const entry of batchEntries()) if (entry.canConfirm) batchSelection.add(entry.key); syncBatchSelection(); });
    const batchClear = button('清空选择', () => { batchSelection.clear(); syncBatchSelection(); });
    const batchConfirm = button('确认所选', confirmBatch, 'primary');
    batchFooter.append(batchCount, batchAll, batchClear, batchConfirm);
    batchDialog.append(batchHeader, batchHelp, batchList, batchFooter);

    const nameEditor = el('dialog', 'ssi-name-editor'); nameEditor.setAttribute('aria-labelledby', 'ssi-name-editor-heading');
    const nameHeader = el('header', 'ssi-header');
    const nameHeading = el('h2', '', '校对评级文字'); nameHeading.id = 'ssi-name-editor-heading';
    const nameClose = button('×', closeNameEditor, 'ssi-icon'); nameClose.setAttribute('aria-label', '取消评级文字校对');
    nameHeader.append(nameHeading, nameClose);
    const nameBody = el('div', 'ssi-name-edit-body');
    const nameCrop = el('canvas', 'ssi-name-crop'); nameCrop.setAttribute('aria-label', '原图评级文字');
    const nameDraft = el('textarea', 'ssi-name-draft'); nameDraft.maxLength = 300; nameDraft.rows = 6; nameDraft.setAttribute('aria-label', '校对评级名称');
    const nameConfirm = button('确认文字', () => {
      const tier = tiers.find(value => value.key === nameEditorKey), value = nameDraft.value.trim();
      if (!tier || !value || value.length > 300) return;
      tier.name = value; tier.nameNeedsReview = false; closeNameEditor(); renderTiers();
    }, 'primary');
    nameDraft.addEventListener('input', () => { nameConfirm.disabled = !nameDraft.value.trim() || nameDraft.value.trim().length > 300; });
    const nameFooter = el('footer', 'ssi-batch-footer'); nameFooter.append(button('取消', closeNameEditor), nameConfirm);
    nameBody.append(nameCrop, nameDraft); nameEditor.append(nameHeader, nameBody, nameFooter);
    document.body.append(dialog, batchDialog, editor, nameEditor);

    function findItem(key) {
      for (const tier of tiers) {
        const index = tier.cards.findIndex(item => item.key === key);
        if (index >= 0) return {tier, index, item: tier.cards[index]};
      }
      return null;
    }
    function getProblems() {
      const frequency = new Map(), items = new Map(), levels = new Map(), critical = new Set(), identityProblems = new Map();
      const flat = tiers.flatMap(tier => tier.cards);
      for (const item of flat) if (byId.has(item.id)) frequency.set(item.id, (frequency.get(item.id) || 0) + 1);
      for (const item of flat) {
        let reason = '', level = 'none';
        if (!byId.has(item.id)) identityProblems.set(item.key, '未识别卡牌，生成时跳过');
        else if (frequency.get(item.id) > 1) identityProblems.set(item.key, '重复卡牌，生成时只保留首次出现的位置');
        if (identityProblems.has(item.key) && !item.reviewAcknowledged) { reason = `大概率错误 · ${identityProblems.get(item.key)}`; level = 'critical'; }
        else if (item.duplicateReview) { reason = '大概率错误 · 曾出现重复识别，请核对这张卡牌'; level = 'critical'; }
        else if (!item.confirmed) {
          level = item.reviewLevel || 'severe';
          if (level === 'none') level = 'moderate';
          reason = level === 'critical' ? '大概率错误' : level === 'severe' ? '严重不确定' : '比较不确定';
        }
        if (reason) { items.set(item.key, reason); levels.set(item.key, level); if (level === 'critical') critical.add(item.key); }
      }
      const unknown = flat.filter(item => !byId.has(item.id)).length;
      return {items, levels, critical, identityProblems, total: flat.length, recognized: frequency.size, unknown, duplicates: flat.length - unknown - frequency.size, invalidNames: tiers.some(tier => !tier.name.trim() || tier.name.trim().length > 300), nameReviews: tiers.filter(tier => tier.nameNeedsReview).length, emptyTitle: !titleInput.value.trim()};
    }
    function updateStatus() {
      const problems = getProblems();
      countText.textContent = tiers.length ? `${tiers.length} 档 · ${problems.total} 张` : '尚未导入截图';
      const severeCount = [...problems.levels.values()].filter(level => level === 'severe').length;
      const moderateCount = [...problems.levels.values()].filter(level => level === 'moderate').length;
      criticalCards.textContent = `!!! ${problems.critical.size} 张大概率错误 →`;
      criticalCards.title = '建议核对，也可按当前识别结果直接生成'; criticalCards.hidden = !problems.critical.size;
      pendingCards.textContent = `!! ${severeCount} 张严重不确定 →`;
      pendingCards.title = '打开批量核对；也可保留当前识别结果生成'; pendingCards.hidden = !severeCount;
      moderateCards.textContent = `! ${moderateCount} 张比较不确定 →`;
      moderateCards.title = '建议核对，也可保留当前识别结果直接生成'; moderateCards.hidden = !moderateCount;
      pendingNames.textContent = `! ${problems.nameReviews} 档文字待核对 →`;
      pendingNames.title = '批量对照原图，确认或修改评级文字'; pendingNames.hidden = !problems.nameReviews;
      criticalCards.disabled = pendingCards.disabled = moderateCards.disabled = pendingNames.disabled = busy || applyBusy;
      reviewSummary.hidden = !problems.items.size && !problems.nameReviews;
      footer.classList.toggle('ssi-has-pending', !reviewSummary.hidden);
      applyNote.textContent = [problems.duplicates ? `${problems.duplicates} 张重复卡只保留首次位置` : '', problems.unknown ? `跳过 ${problems.unknown} 张未识别卡牌` : ''].filter(Boolean).join('；');
      applyNote.hidden = !applyNote.textContent;
      apply.disabled = busy || applyBusy || !tiers.length || !problems.recognized || problems.invalidNames || problems.emptyTitle;
      apply.title = problems.invalidNames ? '请填写每个评级名称（最多 300 字）' : problems.emptyTitle ? '请填写标题' : !problems.recognized ? '尚无可生成的卡牌，请选择至少一张卡牌' : applyNote.textContent;
      addTier.disabled = busy || tiers.length >= 24; cropButton.disabled = busy || !source; zoomSlider.disabled = !source;
      upload.disabled = applyBusy; titleInput.disabled = busy || applyBusy;
    }
    function batchEntries() {
      if (batchKind === 'name') return tiers.filter(tier => tier.nameNeedsReview).map(tier => ({
        key: tier.key, tier, name: tier.name, box: tier.labelBox,
        canConfirm: !!tier.name.trim() && tier.name.trim().length <= 300,
        note: `第 ${tiers.indexOf(tier) + 1} 档 · 点击文字可修改`
      }));
      const problems = getProblems();
      return tiers.flatMap(tier => tier.cards.filter(item => problems.levels.get(item.key) === batchKind).map(item => ({
        key: item.key, tier, item, name: byId.get(item.id)?.name || '未识别卡牌', box: item.box,
        canConfirm: true,
        note: `${tier.name} · ${problems.identityProblems.get(item.key) || (item.duplicateReview ? problems.items.get(item.key) : item.reviewReason || problems.items.get(item.key))}`
      })));
    }
    function openBatch(kind) {
      if (busy || applyBusy) return;
      hideHover(); batchReturnFocus = document.activeElement; batchKind = kind; batchSelection.clear();
      batchList.scrollTop = 0; renderBatch();
      if (!batchDialog.open) batchDialog.showModal();
    }
    function closeBatch() {
      if (!batchKind && !batchDialog.open && !nameEditor.open) return;
      batchKind = null; batchSelection.clear();
      closeNameEditor(); if (editorSession) cancelEditor();
      if (batchDialog.open) batchDialog.close();
      if (batchReturnFocus?.isConnected && !batchReturnFocus.hidden) batchReturnFocus.focus({preventScroll: true});
      else if (dialog.open) closeButton.focus({preventScroll: true});
      batchReturnFocus = null;
    }
    function drawComparisonCrop(canvas, box) {
      canvas.hidden = !source || !box;
      if (!source || !box) return;
      const scale = Math.min(2, 320 / Math.max(box.width, box.height));
      canvas.width = Math.max(1, Math.round(box.width * scale)); canvas.height = Math.max(1, Math.round(box.height * scale));
      canvas.getContext('2d').drawImage(source, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
    }
    function renderBatch() {
      if (!batchKind) return;
      const labels = {critical: '大概率错误', severe: '严重不确定', moderate: '比较不确定', name: '评级文字'};
      const entries = batchEntries(), eligible = new Set(entries.filter(entry => entry.canConfirm).map(entry => entry.key));
      for (const key of batchSelection) if (!eligible.has(key)) batchSelection.delete(key);
      batchHeading.textContent = `批量核对 · ${labels[batchKind]}`;
      batchHelp.textContent = batchKind === 'name' ? '对照原图，勾选正确文字；点击识别结果可修改。' : '对照左右卡图，勾选接受的识别结果；点击识别结果可单张校对。核对可跳过；生成时重复卡只保留首次位置，未识别卡牌跳过。';
      const scrollTop = batchList.scrollTop; batchList.replaceChildren();
      for (const entry of entries) {
        const row = el('section', 'ssi-batch-item'); row.dataset.batchKey = String(entry.key);
        const rowHeading = el('div', 'ssi-batch-item-heading');
        const checkLabel = el('label', 'ssi-batch-check'), check = el('input'); check.type = 'checkbox';
        check.dataset.batchKey = String(entry.key); check.disabled = !entry.canConfirm;
        check.setAttribute('aria-label', `选择核对${entry.name}`);
        check.addEventListener('change', () => { if (check.checked && entry.canConfirm) batchSelection.add(entry.key); else batchSelection.delete(entry.key); syncBatchSelection(); });
        checkLabel.append(check, el('span', '', entry.name)); rowHeading.append(checkLabel);
        if (entry.item) {
          const confidence = byId.has(entry.item.id) && Number.isFinite(entry.item.confidence) ? entry.item.confidence : 0;
          rowHeading.append(el('span', 'ssi-batch-score', `${Math.round(bounded(confidence, 0, 1) * 100)}%`));
        }
        const comparison = button('', () => { if (batchKind === 'name') openNameEditor(entry.key); else openEditor(entry.key); }, 'ssi-batch-compare');
        comparison.setAttribute('aria-label', `校对${batchKind === 'name' ? '评级文字' : '卡牌'}${entry.name}`);
        const original = el('div'), recognized = el('div'), crop = el('canvas'); crop.setAttribute('aria-label', '原图裁切');
        drawComparisonCrop(crop, entry.box); original.append(el('span', '', '原图裁切'), crop);
        if (crop.hidden) original.append(el('span', 'ssi-batch-unknown', '无原图裁切'));
        recognized.append(el('span', '', '识别结果'));
        if (entry.item) {
          const card = byId.get(entry.item.id);
          if (card) { const img = el('img'); img.src = imageOf(card); img.alt = card.name; img.loading = 'lazy'; img.decoding = 'async'; recognized.append(img); }
          else recognized.append(el('span', 'ssi-batch-unknown', '尚未识别，点击选牌'));
        } else recognized.append(el('span', 'ssi-batch-recognized-name', entry.name));
        comparison.append(original, recognized); row.append(rowHeading, comparison, el('p', 'ssi-batch-note', entry.note)); batchList.append(row);
      }
      if (!entries.length) batchList.append(el('p', 'ssi-batch-empty', '本组已全部核对完成'));
      batchList.scrollTop = scrollTop; syncBatchSelection();
    }
    function syncBatchSelection() {
      const entries = batchEntries();
      for (const row of batchList.querySelectorAll('.ssi-batch-item')) {
        const checked = batchSelection.has(Number(row.dataset.batchKey)); row.classList.toggle('ssi-batch-selected', checked);
        row.querySelector('input').checked = checked;
      }
      batchCount.textContent = `已选 ${batchSelection.size} / ${entries.length} 项`;
      batchConfirm.disabled = !batchSelection.size; batchClear.disabled = !batchSelection.size;
      batchAll.disabled = !entries.some(entry => entry.canConfirm && !batchSelection.has(entry.key));
    }
    function confirmBatch() {
      // Resolve again so edits cannot confirm entries from a stale selection.
      for (const entry of batchEntries()) if (batchSelection.has(entry.key) && entry.canConfirm) {
        if (entry.item) Object.assign(entry.item, {confirmed: true, reviewAcknowledged: true, reviewLevel: 'none', reviewReason: '', needsReview: false, duplicateReview: false});
        else entry.tier.nameNeedsReview = false;
      }
      batchSelection.clear(); renderTiers();
    }
    function openNameEditor(key) {
      const tier = tiers.find(value => value.key === key); if (!tier) return;
      nameEditor.dataset.tierKey = String(key);
      nameEditorKey = key; nameDraft.value = tier.name; nameConfirm.disabled = !tier.name.trim() || tier.name.trim().length > 300;
      drawComparisonCrop(nameCrop, tier.labelBox); if (!nameEditor.open) nameEditor.showModal(); nameDraft.focus();
    }
    function closeNameEditor() {
      nameEditorKey = null; if (nameEditor.open) nameEditor.close();
    }
    function restoreBatchFocus(key) {
      if (!batchDialog.open) return;
      const row = batchList.querySelector(`[data-batch-key="${key}"]`);
      (row?.querySelector('.ssi-batch-compare') || batchClose).focus({preventScroll: true});
    }
    function renderTiers() {
      hideHover();
      // A duplicate makes every involved crop suspect. Resolving another crop
      // does not verify this one; retain its warning until explicit review.
      const frequency = new Map();
      for (const tier of tiers) for (const item of tier.cards) if (byId.has(item.id)) frequency.set(item.id, (frequency.get(item.id) || 0) + 1);
      for (const tier of tiers) for (const item of tier.cards) if (frequency.get(item.id) > 1 && !item.reviewAcknowledged) item.duplicateReview = true;
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
        name.addEventListener('input', () => { tier.name = name.value; tier.nameNeedsReview = false; name.classList.remove('ssi-name-review'); name.removeAttribute('aria-describedby'); nameFlag.hidden = true; confirmName.hidden = true; name.style.height = 'auto'; name.style.height = Math.min(220, Math.max(34, name.scrollHeight)) + 'px'; updateStatus(); renderSelectionTools(); drawOverlay(); });
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
          const level = problems.levels.get(item.key);
          const confidenceText = `${Math.round(bounded(card && Number.isFinite(item.confidence) ? item.confidence : 0, 0, 1) * 100)}%`;
          const confidenceDescription = `识别置信度 ${confidenceText} · ${problem || ''}${item.reviewReason ? ' · ' + item.reviewReason : ''}`;
          const cardButton = button('', () => { lastTier = tier.key; openEditor(item.key); }, `ssi-review-card${problem ? ' ssi-needs-review ssi-review-' + level : ''}${selected === item.key ? ' ssi-selected' : ''}`);
          cardButton.dataset.reviewKey = String(item.key);
          cardButton.setAttribute('aria-label', `${card?.name || '未识别卡牌'}${problem ? `，${confidenceDescription}` : ''}，点击校对`);
          if (card) { const img = el('img'); img.src = imageOf(card); img.alt = ''; img.loading = 'lazy'; cardButton.append(img); }
          else { const placeholder = el('span', 'ssi-unknown'); placeholder.textContent = '?'; cardButton.append(placeholder); }
          cardButton.append(el('span', 'ssi-card-name', card?.name || '未识别'));
          if (problem) {
            const badge = el('small', 'ssi-card-badge ssi-confidence-badge', confidenceText);
            badge.title = confidenceDescription; cardButton.title = confidenceDescription; cardButton.append(badge);
          } else if (card?.unavailableInVersion) cardButton.append(el('small', 'ssi-card-badge', '版本外'));
          rowCards.append(cardButton);
        }
        const add = button('＋ 卡牌', () => {
          addCard(tier, null);
        }, 'ssi-add-card'); add.disabled = busy; rowCards.append(add);
        row.append(rowHeader, rowCards); tierList.append(row);
      }
      updateStatus(); renderSelectionTools(); drawOverlay(); renderBatch();
    }
    function drawOverlay() {
      if (!source) return;
      if (overlay.width !== source.width || overlay.height !== source.height) { overlay.width = source.width; overlay.height = source.height; }
      const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, overlay.width, overlay.height);
      const problems = getProblems();
      const scale = source.width / Math.max(sourceStage.clientWidth, 1);
      if (cropping) {
        ctx.fillStyle = 'rgba(5, 7, 10, .48)'; ctx.fillRect(0, 0, overlay.width, overlay.height);
        for (const tier of tiers) for (const item of tier.cards) {
          if (item.box && byId.has(item.id)) ctx.clearRect(item.box.x, item.box.y, item.box.width, item.box.height);
        }
      }
      for (const tier of tiers) for (const item of tier.cards) {
        if (!item.box) continue;
        const {x, y, width, height} = item.box;
        const pending = problems.items.has(item.key), level = problems.levels.get(item.key), isSelected = selected === item.key;
        const color = level === 'critical' ? '#ff3d6e' : level === 'severe' ? '#ff7770' : '#ffbf66';
        ctx.lineWidth = Math.max(1.5, (pending || isSelected ? 3 : 1) * scale);
        ctx.strokeStyle = pending ? color : isSelected ? '#fff0b8' : '#94ddab';
        ctx.fillStyle = pending ? (level === 'critical' ? '#ff235544' : level === 'severe' ? '#ff544033' : '#ffb63826') : isSelected ? '#ffdd661f' : '#00000000';
        ctx.fillRect(x, y, width, height); ctx.strokeRect(x, y, width, height);
        if (pending || cropping) {
          const size = Math.min(16 * scale, width * .35, height * .35);
          ctx.fillStyle = pending ? color : '#94ddab'; ctx.fillRect(x, y, size, size);
          ctx.fillStyle = '#2c1808'; ctx.font = `bold ${size * .8}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(pending ? (level === 'critical' ? '×' : level === 'severe' ? '!!' : '!') : '✓', x + size / 2, y + size / 2);
        }
      }
      if (cropping && selectionMode === 'tier') {
        const layout = gesture?.layout || pendingLayout || tierLayout;
        if (layout) layout.boundaries.forEach((y, i) => {
          const outer = i === 0 || i === layout.boundaries.length - 1;
          const active = gesture?.lineIndex === i;
          ctx.lineWidth = (active ? 3 : 2) * scale; ctx.strokeStyle = active ? '#fff0b8' : '#8ed8ff';
          ctx.setLineDash(outer ? [6 * scale, 4 * scale] : []);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(source.width, y); ctx.stroke(); ctx.setLineDash([]);
          const label = outer ? (i ? '底部' : '顶部') : `↕ ${i}`;
          const handleY = bounded(y - 9 * scale, 0, source.height - 18 * scale);
          ctx.fillStyle = active ? '#fff0b8' : '#8ed8ff'; ctx.fillRect(0, handleY, 40 * scale, 18 * scale);
          ctx.fillStyle = '#143b50'; ctx.font = `${11 * scale}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(label, 20 * scale, handleY + 9 * scale);
        });
      }
      if (cropRect) {
        ctx.strokeStyle = gesture?.erase ? '#ff9d97' : '#fff0b8'; ctx.fillStyle = gesture?.erase ? '#fa605033' : '#dfc58b33'; ctx.setLineDash([6 * scale, 4 * scale]);
        ctx.fillRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height); ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height); ctx.setLineDash([]);
      }
    }
    function hideHover() { hoverPanel.hidden = true; hoverKey = null; }
    function showHover(event) {
      if (!source || busy || applyBusy || editor.open || batchDialog.open || gesture || (cropping && selectionMode === 'tier')) { hideHover(); return; }
      const p = point(event);
      let found = null;
      for (const tier of tiers) for (const item of tier.cards) {
        const b = item.box;
        if (b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) found = {tier, item};
      }
      if (!found) { hideHover(); return; }
      if (hoverKey !== found.item.key) {
        hoverKey = found.item.key;
        const {item, tier} = found, card = byId.get(item.id), b = item.box;
        hoverTitle.textContent = card?.name || '尚未识别';
        hoverNote.textContent = `${tier.name} · ${getProblems().items.get(item.key) || '已确认'} `;
        const ratio = Math.min(3, 300 / Math.max(b.width, b.height));
        hoverCrop.width = Math.max(1, Math.round(b.width * ratio)); hoverCrop.height = Math.max(1, Math.round(b.height * ratio));
        hoverCrop.getContext('2d').drawImage(source, b.x, b.y, b.width, b.height, 0, 0, hoverCrop.width, hoverCrop.height);
        hoverImage.hidden = !card; hoverUnknown.hidden = !!card;
        if (card) hoverImage.src = card.imageZh || card.imageEn || imageOf(card);
        else hoverImage.removeAttribute('src');
      }
      hoverPanel.hidden = false;
      const bounds = dialog.getBoundingClientRect(), width = hoverPanel.offsetWidth || 320, height = hoverPanel.offsetHeight || 255;
      const preferredX = event.clientX + 18 + width <= bounds.right - 8 ? event.clientX + 18 : event.clientX - width - 18;
      hoverPanel.style.left = `${bounded(preferredX, bounds.left + 8, Math.max(bounds.left + 8, bounds.right - width - 8))}px`;
      hoverPanel.style.top = `${bounded(event.clientY + 16, bounds.top + 8, Math.max(bounds.top + 8, bounds.bottom - height - 8))}px`;
    }
    function openEditor(key, isNew = false) {
      if (busy || !findItem(key)) return;
      hideHover();
      if (editorSession) cancelEditor();
      const found = findItem(key); if (!found) return;
      selected = key; editorTarget = key;
      editorSession = {key, isNew, tierKey: found.tier.key, draft: {...found.item, candidates: [...(found.item.candidates || [])]}, touched: false, matching: false, message: '', controller: null};
      search.value = ''; setupFilters(); renderTiers(); renderEditor();
      if (!editor.open) editor.showModal();
      if (isNew && found.item.box) recognizeDraft(editorSession);
    }
    function finishEditor() {
      editorSession?.controller?.abort(); editorSession = null; editorTarget = null;
      if (editor.open) editor.close();
    }
    function cancelEditor() {
      if (editorSession?.isNew) {
        const found = findItem(editorSession.key); if (found) found.tier.cards.splice(found.index, 1);
        if (selected === editorSession.key) selected = null;
      }
      finishEditor(); renderTiers();
    }
    function confirmEditor() {
      const session = editorSession, found = findItem(session?.key), tier = tiers.find(value => value.key === session?.tierKey);
      if (!session || !found || !tier || !byId.has(session.draft.id)) return;
      Object.assign(found.item, session.draft, {confirmed: true, reviewAcknowledged: true, reviewLevel: 'none', reviewReason: '', needsReview: false, duplicateReview: false});
      if (tier !== found.tier) { found.tier.cards.splice(found.index, 1); tier.cards.push(found.item); }
      sortCards(tier); lastTier = tier.key; finishEditor(); renderTiers();
    }
    async function recognizeDraft(session) {
      if (!source || !session.draft.box) return;
      session.controller = new AbortController(); session.matching = true; renderEditor();
      const imageSource = source, requestRevision = revision, signal = session.controller.signal;
      try {
        if (!root.SpireScreenshotEngine?.analyzeBox) throw new Error('单卡识别组件未加载，请从卡库选择');
        const match = await root.SpireScreenshotEngine.analyzeBox(imageSource.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, imageSource.width, imageSource.height), session.draft.box, {signal});
        if (signal.aborted || session !== editorSession || requestRevision !== revision || source !== imageSource) return;
        session.draft.candidates = (match?.candidates || []).filter(candidate => byId.has(candidate.id)).slice(0, 8);
        if (!session.touched) session.draft.id = byId.has(match?.id) ? match.id : session.draft.candidates[0]?.id || null;
        session.draft.confidence = Number.isFinite(match?.confidence) ? match.confidence : 0;
        session.draft.reviewReason = match?.reviewReason || '';
        Object.assign(session.draft, root.SpireScreenshotEngine.classifyReview?.(match) || {});
        session.message = session.draft.candidates.length || session.draft.id ? '已识别候选，请核对卡牌与所属评级后确认' : '未识别到卡牌，请从卡库选择';
      } catch (error) {
        if (signal.aborted || session !== editorSession) return;
        session.message = error?.message || '识别失败，请从卡库选择';
      } finally {
        if (session === editorSession && !signal.aborted) { session.matching = false; renderEditor(); }
      }
    }
    function renderEditor(refreshChoices = true) {
      const session = editorSession; if (!session || !findItem(session.key)) return;
      catalogPrompt.textContent = getLanguage() === 'en' ? "Can't find the card you want? Look below!" : '没找到想要的牌？从下面寻找！';
      const card = byId.get(session.draft.id); editName.textContent = card?.name || '选择对应卡牌';
      editHeading.textContent = session.isNew ? '校对新增卡牌' : '校对卡牌';
      const problem = getProblems().items.get(session.key);
      editProblem.textContent = (session.matching ? '正在本机识别… 也可先从卡库选择' : session.message || [problem || '请核对卡牌', session.draft.reviewReason].filter(Boolean).join(' · ')) + (card?.unavailableInVersion ? ' · 此版本未收录，卡面来自 ' + card.gameVersion : '');
      confirm.disabled = !card; remove.hidden = session.isNew; tierSelect.replaceChildren();
      for (const tier of tiers) { const option = el('option', '', tier.name); option.value = String(tier.key); tierSelect.append(option); }
      tierSelect.value = String(session.tierKey);
      const box = session.draft.box; sourceCrop.hidden = !source || !box;
      if (source && box) {
        const ratio = Math.min(1, 420 / Math.max(box.width, box.height));
        sourceCrop.width = Math.max(1, Math.round(box.width * ratio)); sourceCrop.height = Math.max(1, Math.round(box.height * ratio));
        sourceCrop.getContext('2d').drawImage(source, box.x, box.y, box.width, box.height, 0, 0, sourceCrop.width, sourceCrop.height);
      }
      if (refreshChoices) { renderRecommendations(); renderCandidates(); }
      else updateChoiceSelection();
    }
    function setupFilters() {
      const colorNames = {ironclad: '铁甲战士', silent: '静默猎手', regent: '储君', necrobinder: '亡灵契约师', defect: '故障机器人', colorless: '无色', curse: '诅咒', status: '状态'};
      for (const [field, key, label, names] of [[colorFilter, 'color', '全部职业 / 颜色', colorNames], [rarityFilter, 'rarity', '全部稀有度', {}], [typeFilter, 'type', '全部类型', {}], [costFilter, 'cost', '全部费用', {}]]) {
        field.replaceChildren(); const all = el('option', '', label); all.value = ''; field.append(all);
        const values = [...new Set(catalog.map(card => String(card[key] ?? '')))].filter(Boolean).sort((a, b) => (key === 'color' ? 1 : -1) * root.SpireBoardModel.compareCards({id: '', [key]: a}, {id: '', [key]: b}) || a.localeCompare(b, 'zh-CN', {numeric: true}));
        for (const value of values) { const option = el('option', '', names[value] || value); option.value = value; field.append(option); }
        field.value = key === 'color' && values.includes(rememberedColorFilter) ? rememberedColorFilter : '';
      }
    }
    function renderCandidates() {
      const session = editorSession; if (!session) return;
      const query = search.value.trim().toLowerCase();
      const list = catalog.filter(card => (!query || `${card.name} ${card.english} ${card.id}`.toLowerCase().includes(query)) && (!colorFilter.value || card.color === colorFilter.value) && (!rarityFilter.value || card.rarity === rarityFilter.value) && (!typeFilter.value || card.type === typeFilter.value) && (!costFilter.value || String(card.cost) === costFilter.value));
      candidateHeading.textContent = `完整卡库 · ${list.length} 张卡牌 · 选择后点击「确认」`;
      clearFilters.disabled = !(query || colorFilter.value || rarityFilter.value || typeFilter.value || costFilter.value);
      candidateGrid.replaceChildren();
      if (!list.length) candidateGrid.append(el('p', 'ssi-no-results', '没有找到卡牌，可清除搜索或放宽筛选'));
      renderChoices(candidateGrid, list, session);
    }
    function renderRecommendations() {
      const session = editorSession; if (!session) return;
      const ids = [...new Set((session.draft.candidates || []).map(candidate => candidate.id).filter(id => byId.has(id)))].slice(0, 4);
      recommendationGrid.replaceChildren();
      if (!ids.length) {
        const message = el('p', 'ssi-no-recommendations', session.matching ? '正在识别候选…' : '暂无识别候选，可从下方卡库选择');
        message.setAttribute('role', 'status'); recommendationGrid.append(message);
      }
      renderChoices(recommendationGrid, ids.map(id => byId.get(id)), session, true);
    }
    function selectChoice(session, card) {
      if (session !== editorSession) return;
      session.draft.id = card.id; session.touched = true; session.message = '已选择卡牌，点击「确认」保存';
      // Keep the clicked button connected so the browser can deliver dblclick.
      renderEditor(false);
    }
    function updateChoiceSelection() {
      for (const grid of [recommendationGrid, candidateGrid]) for (const pick of grid.querySelectorAll('.ssi-candidate')) {
        const current = pick.dataset.cardId === editorSession?.draft.id;
        pick.classList.toggle('ssi-current', current); pick.setAttribute('aria-pressed', String(current));
      }
    }
    function renderChoices(grid, list, session, quickConfirm = false) {
      for (const card of list) {
        const pick = button('', () => selectChoice(session, card), quickConfirm ? 'ssi-candidate ssi-recommended-card' : 'ssi-candidate');
        pick.dataset.cardId = card.id;
        pick.setAttribute('aria-label', quickConfirm ? `推荐${card.name}，双击确认` : `选择${card.name}`); pick.setAttribute('aria-pressed', String(card.id === session.draft.id));
        if (quickConfirm) pick.addEventListener('dblclick', () => {
          if (session !== editorSession) return;
          selectChoice(session, card); confirmEditor();
        });
        if (card.id === session.draft.id) pick.classList.add('ssi-current');
        const img = el('img'); img.src = imageOf(card); img.alt = ''; img.loading = 'lazy';
        pick.append(img, el('span', '', card.name + (card.unavailableInVersion ? ' · 版本外' : ''))); grid.append(pick);
      }
    }
    function point(event) {
      const box = overlay.getBoundingClientRect();
      return {x: bounded((event.clientX - box.left) * source.width / box.width, 0, source.width), y: bounded((event.clientY - box.top) * source.height / box.height, 0, source.height)};
    }
    function setZoom(value, keepCenter = true) {
      const oldWidth = sourceStage.clientWidth || 1, oldHeight = sourceStage.clientHeight || 1;
      const centerX = oldWidth <= sourceScroll.clientWidth - 20 ? .5 : bounded((sourceScroll.scrollLeft + sourceScroll.clientWidth / 2 - 10) / oldWidth, 0, 1);
      const centerY = oldHeight <= sourceScroll.clientHeight - 20 ? .5 : bounded((sourceScroll.scrollTop + sourceScroll.clientHeight / 2 - 10) / oldHeight, 0, 1);
      zoom = bounded(value, 50, 400); sourceStage.style.width = `${zoom}%`; zoomSlider.value = String(zoom); zoomValue.textContent = `${zoom}%`;
      zoomSlider.setAttribute('aria-valuetext', `${zoom}%${zoom === 100 ? '，适应宽度' : ''}`);
      if (keepCenter) sourceScroll.scrollTo({left: centerX * sourceStage.clientWidth - sourceScroll.clientWidth / 2 + 10, top: centerY * sourceStage.clientHeight - sourceScroll.clientHeight / 2 + 10});
      drawOverlay();
    }
    function renderSelectionTools() {
      selectionToolbar.hidden = !cropping; cropButton.setAttribute('aria-pressed', String(cropping));
      cardMode.setAttribute('aria-pressed', String(selectionMode === 'card')); tierMode.setAttribute('aria-pressed', String(selectionMode === 'tier'));
      addBoxTool.setAttribute('aria-pressed', String(selectionTool === 'add')); eraseTool.setAttribute('aria-pressed', String(selectionTool === 'erase'));
      sourceStage.classList.toggle('ssi-cropping', cropping); sourceStage.classList.toggle('ssi-erasing', cropping && selectionMode === 'card' && selectionTool === 'erase');
      sourcePane.classList.toggle('ssi-manual-active', cropping);
      selectionActions.hidden = selectionMode === 'tier';
      for (const control of [cardMode, tierMode, addBoxTool, eraseTool]) control.disabled = busy || applyBusy;
      overlay.style.cursor = '';
      drawOverlay();
    }
    function sortCards(tier) {
      tier.cards.sort((a, b) => {
        if (!a.box || !b.box) return a.box ? -1 : b.box ? 1 : 0;
        const sameLine = Math.abs(a.box.y - b.box.y) < Math.min(a.box.height, b.box.height) * .5;
        return sameLine ? a.box.x - b.box.x : a.box.y - b.box.y;
      });
    }
    function inferredTier(box) {
      const centerX = box.x + box.width / 2, centerY = box.y + box.height / 2;
      let best = null, bestScore = 0;
      for (const tier of tiers) {
        const b = tier.box; if (!b) continue;
        const overlap = Math.max(0, Math.min(box.x + box.width, b.x + b.width) - Math.max(box.x, b.x)) * Math.max(0, Math.min(box.y + box.height, b.y + b.height) - Math.max(box.y, b.y));
        const contains = centerX >= b.x && centerX <= b.x + b.width && centerY >= b.y && centerY <= b.y + b.height;
        const score = (contains ? box.width * box.height : 0) + overlap;
        if (score > bestScore) { best = tier; bestScore = score; }
      }
      return best || tiers.find(tier => tier.key === lastTier) || tiers[0];
    }
    function addCard(tier, box) {
      if (!tier) { tier = {key: ++serial, name: '档位 1', color: '#d6c08a', cards: []}; tiers.push(tier); }
      const item = {key: ++serial, id: null, candidates: [], confidence: 0, confirmed: false, box};
      tier.cards.push(item); lastTier = tier.key; sortCards(tier); openEditor(item.key, true);
    }
    function resetGesture() {
      const previousGesture = gesture;
      gesture = null; cropStart = null; cropRect = null;
      if (previousGesture && overlay.hasPointerCapture(previousGesture.pointerId)) overlay.releasePointerCapture(previousGesture.pointerId);
      drawOverlay();
    }
    function lineAt(p) {
      if (!tierLayout) return -1;
      const tolerance = 7 * source.height / Math.max(overlay.getBoundingClientRect().height, 1);
      let hit = -1, nearest = Infinity;
      tierLayout.boundaries.forEach((y, i) => { const distance = Math.abs(p.y - y); if (distance <= tolerance && distance < nearest) { hit = i; nearest = distance; } });
      return hit;
    }
    function moveLine(action, y) {
      const edges = action.layout.boundaries, i = action.lineIndex;
      edges[i] = bounded(Math.round(y), i ? edges[i - 1] + 16 : 0, i < edges.length - 1 ? edges[i + 1] - 16 : source.height);
    }
    function layoutFromResult(result) {
      if (result.tierLayout) return {...result.tierLayout, boundaries: result.tierLayout.boundaries.slice(0, 25)};
      const rows = (result.tiers || []).filter(t => Number.isFinite(t.y0) && Number.isFinite(t.y1)).sort((a, b) => a.y0 - b.y0);
      const label = rows.find(t => t.labelBox)?.labelBox;
      return {boundaries: rows.length ? [...rows.map(t => t.y0), rows.at(-1).y1] : [0, source.height],
        left: label?.x || 0, right: label ? label.x + label.width : Math.max(16, Math.round(source.width * .1)),
        baseHeight: rows.length ? Math.max(16, Math.min(...rows.map(t => t.y1 - t.y0))) : Math.min(source.height, Math.max(16, source.width * .09))};
    }
    async function recognizeDivisions(layout) {
      if (busy || !source) return;
      closeBatch(); cancelEditor(); hideHover();
      const thisRevision = ++revision, imageSource = source;
      controller = new AbortController(); const signal = controller.signal;
      busy = true; pendingLayout = layout; selected = null;
      cancel.hidden = false; progress.hidden = false; progress.value = 0;
      statusText.textContent = '按新分隔线重新识别卡牌…'; renderTiers();
      const current = () => !signal.aborted && revision === thisRevision && source === imageSource;
      try {
        const result = await root.SpireScreenshotEngine.analyze(imageSource.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, imageSource.width, imageSource.height), {
          signal, tierLayout: layout,
          onProgress(value) { if (current()) { progress.value = bounded(value?.progress || 0, 0, 1) * .65; statusText.textContent = value?.message || '重新识别卡牌…'; } }
        });
        if (!current()) return;
        const next = reviewTiers(result, imageSource);
        if (next.length !== layout.boundaries.length - 1) throw new Error('分档结果不完整，已保留调整前的结果');
        // Names/colors already reviewed in untouched regions survive a new cut.
        const changed = [];
        next.forEach((tier, i) => {
          const previous = tiers.find(t => t.box && t.box.y === tier.box?.y && t.box.height === tier.box?.height);
          if (previous) { tier.name = previous.name; tier.nameNeedsReview = previous.nameNeedsReview; tier.color = previous.color; }
          else changed.push(i);
        });
        const notes = (result.warnings || []).filter(note => !String(note).startsWith('评级名称需要手动填写'));
        if (changed.length) {
          try {
            if (!root.SpireScreenshotOCR?.recognize) throw new Error('文字识别组件未加载');
            const textResult = await root.SpireScreenshotOCR.recognize(imageSource, changed.map(i => result.tiers[i]), {
              signal, original: originalImage,
              onProgress(value) { if (current()) { progress.value = .65 + .35 * bounded(value?.progress || 0, 0, 1); statusText.textContent = value?.message || '识别新档位文字…'; } }
            });
            if (!current()) return;
            changed.forEach((i, n) => {
              const label = textResult.labels?.[n], text = String(label?.text || '').trim();
              if (text) next[i].name = text;
              next[i].nameNeedsReview = !text || label?.needsReview === true || text.length > 300;
            });
            notes.push(...(textResult.warnings || []));
          } catch (error) {
            if (!current()) return;
            notes.push('新档位文字识别未完成，请手动填写档名；卡牌已重新识别');
          }
        }
        if (!current()) return;
        tiers = next; tierLayout = {...layout, boundaries: [...layout.boundaries]}; lastTier = tiers[0]?.key;
        warningList.replaceChildren(); for (const note of notes) warningList.append(el('li', '', String(note)));
        warningHeading.textContent = `识别提示（${notes.length}）`; warnings.hidden = !notes.length;
        statusText.textContent = `分隔线已更新 · ${tiers.length} 档、${tiers.reduce((n, t) => n + t.cards.length, 0)} 张卡牌已重新识别`;
      } catch (error) {
        if (current()) statusText.textContent = `${error?.message || '重新识别失败'}；已保留原分隔线和校对结果`;
      } finally {
        if (thisRevision === revision) { busy = false; controller = null; pendingLayout = null; cancel.hidden = true; progress.hidden = true; renderTiers(); }
      }
    }
    function eraseBoxes(box, isClick) {
      const hit = b => b && (isClick ? box.x >= b.x && box.x <= b.x + b.width && box.y >= b.y && box.y <= b.y + b.height : box.x < b.x + b.width && box.x + box.width > b.x && box.y < b.y + b.height && box.y + box.height > b.y);
      let count = 0;
      for (const tier of tiers) tier.cards = tier.cards.filter(item => { if (!hit(item.box)) return true; count++; return false; });
      if (selected && !findItem(selected)) selected = null;
      statusText.textContent = `已擦除 ${count} 张卡牌`;
      renderTiers();
    }
    overlay.addEventListener('contextmenu', event => { if (cropping) event.preventDefault(); });
    overlay.addEventListener('pointerdown', event => {
      hideHover();
      if (!source || busy || applyBusy || editor.open || ![0, 2].includes(event.button)) return;
      const p = point(event);
      if (cropping) {
        if (selectionMode === 'tier') {
          event.preventDefault();
          if (!tierLayout) return;
          const hit = lineAt(p), layout = {...tierLayout, boundaries: [...tierLayout.boundaries]};
          if (event.button === 2) {
            if (hit > 0 && hit < layout.boundaries.length - 1) { layout.boundaries.splice(hit, 1); return recognizeDivisions(layout); }
            statusText.textContent = hit >= 0 ? '顶部和底部不能删除，可拖动调整识别范围' : '请右键点击要删除的横线'; return;
          }
          let lineIndex = hit;
          if (lineIndex < 0) {
            const y = Math.round(p.y), edges = layout.boundaries;
            if (edges.length >= 25) { statusText.textContent = '最多支持24档'; return; }
            if (y < edges[0] + 16 || y > edges.at(-1) - 16 || edges.some(edge => Math.abs(edge - y) < 16)) { statusText.textContent = '新分隔线需要与相邻横线保持距离；图外区域可拖动顶部或底部纳入'; return; }
            if (tiers.some(t => t.cards.some(({box: b}) => b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height))) { statusText.textContent = '请在卡牌之间或左侧标签栏的空白处加线'; return; }
            edges.push(y); edges.sort((a, b) => a - b); lineIndex = edges.indexOf(y);
          }
          cropStart = p; gesture = {pointerId: event.pointerId, mode: 'tier', layout, lineIndex};
          overlay.setPointerCapture(event.pointerId); drawOverlay(); return;
        }
        event.preventDefault(); cropStart = p; cropRect = null;
        gesture = {pointerId: event.pointerId, erase: event.button === 2 || selectionTool === 'erase', mode: selectionMode};
        overlay.setPointerCapture(event.pointerId); return;
      }
      if (event.button !== 0) return;
      for (const tier of tiers) for (const item of tier.cards) {
        const b = item.box;
        if (b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) { lastTier = tier.key; openEditor(item.key); return; }
      }
    });
    overlay.addEventListener('pointermove', event => {
      if (cropping && selectionMode === 'tier') {
        const p = point(event);
        overlay.style.cursor = busy ? 'progress' : lineAt(p) >= 0 || gesture ? 'ns-resize' : 'crosshair';
        if (gesture?.mode === 'tier' && gesture.pointerId === event.pointerId) { moveLine(gesture, p.y); drawOverlay(); }
        return;
      }
      if (!cropStart || gesture?.pointerId !== event.pointerId) { showHover(event); return; }
      const p = point(event); cropRect = {x: Math.min(p.x, cropStart.x), y: Math.min(p.y, cropStart.y), width: Math.abs(p.x - cropStart.x), height: Math.abs(p.y - cropStart.y)}; drawOverlay();
    });
    overlay.addEventListener('pointerup', event => {
      if (!cropStart || gesture?.pointerId !== event.pointerId) return;
      if (gesture.mode === 'tier') {
        moveLine(gesture, point(event).y);
        const layout = gesture.layout; resetGesture();
        if (layout.boundaries.some((y, i) => y !== tierLayout.boundaries[i]) || layout.boundaries.length !== tierLayout.boundaries.length) return recognizeDivisions(layout);
        return;
      }
      const p = point(event), box = {x: Math.min(p.x, cropStart.x), y: Math.min(p.y, cropStart.y), width: Math.abs(p.x - cropStart.x), height: Math.abs(p.y - cropStart.y)};
      const action = gesture, clickPoint = cropStart, clickDistance = Math.hypot(box.width, box.height) * sourceStage.clientWidth / source.width;
      resetGesture();
      if (action.erase) { eraseBoxes(clickDistance < 5 ? {...clickPoint, width: 0, height: 0} : box, clickDistance < 5); return; }
      if (box.width < 8 || box.height < 8) { statusText.textContent = '框选范围太小，请拖出完整范围'; return; }
      addCard(inferredTier(box), box);
    });
    overlay.addEventListener('pointercancel', resetGesture);
    overlay.addEventListener('lostpointercapture', () => { if (gesture) resetGesture(); });
    overlay.addEventListener('pointerleave', hideHover);
    sourceScroll.addEventListener('scroll', hideHover);

    function reviewTiers(result, canvas) {
      const ratioX = canvas.width / (result.width || canvas.width), ratioY = canvas.height / (result.height || canvas.height);
      return (result.tiers || []).slice(0, 24).map((tier, i) => ({
        key: ++serial, name: String(tier.name || `档位 ${i + 1}`), nameNeedsReview: true, color: validColor(tier.color),
        box: tier.box ? {x: tier.box.x * ratioX, y: tier.box.y * ratioY, width: tier.box.width * ratioX, height: tier.box.height * ratioY} : Number.isFinite(tier.y0) && Number.isFinite(tier.y1) ? {x: 0, y: tier.y0 * ratioY, width: canvas.width, height: (tier.y1 - tier.y0) * ratioY} : null,
        labelBox: tier.labelBox ? {x: tier.labelBox.x * ratioX, y: tier.labelBox.y * ratioY, width: tier.labelBox.width * ratioX, height: tier.labelBox.height * ratioY} : null,
        cards: (tier.cards || []).slice(0, cards.length).map(item => {
          const candidates = (item.candidates || []).filter(candidate => byId.has(candidate.id)).slice(0, 8);
          const id = byId.has(item.id) ? item.id : null;
          const confidence = Number.isFinite(item.confidence) ? item.confidence : 0;
          const review = root.SpireScreenshotEngine.classifyReview?.({...item, id, candidates, confidence}) || {reviewLevel: item.reviewLevel || (item.needsReview || confidence < 0.72 ? 'severe' : 'none'), reviewReason: item.reviewReason || ''};
          const box = item.box ? {x: item.box.x * ratioX, y: item.box.y * ratioY, width: item.box.width * ratioX, height: item.box.height * ratioY} : null;
          const reviewReason = String(review.reviewReason || '').slice(0, 120);
          return {key: ++serial, id, candidates, confidence, reviewLevel: review.reviewLevel, confirmed: !!id && review.reviewLevel === 'none', box, reviewReason};
        })
      }));
    }

    async function loadFile(chosen) {
      if (!chosen || applyBusy) return;
      if (!/^image\/(png|jpeg|webp)$/i.test(chosen.type) && !/\.(png|jpe?g|webp)$/i.test(chosen.name)) { statusText.textContent = '请选择 PNG、JPG 或 WebP 图片'; return; }
      if (chosen.size > 40 * 1024 * 1024) { statusText.textContent = '图片过大，请使用 40 MB 以内的截图'; return; }
      closeBatch(); cancelEditor(); resetGesture(); abort(false); const thisRevision = ++revision; busy = true; controller = new AbortController();
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
        source = canvas; originalImage = {blob: chosen, width, height, analysisWidth: canvas.width, analysisHeight: canvas.height};
        tierLayout = layoutFromResult({tiers: []}); pendingLayout = null;
        if (sourceUrl) URL.revokeObjectURL(sourceUrl);
        sourceUrl = objectUrl; objectUrl = null; sourceImage.src = sourceUrl;
        sourceStage.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
        cropping = false; selectionMode = 'card'; selectionTool = 'add'; setZoom(100, false);
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
        tiers = reviewTiers(result, canvas);
        tierLayout = layoutFromResult(result);
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
        statusText.textContent = tiers.some(tier => tier.cards.length) ? '识别完成' : '未定位到卡牌';
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
      controller?.abort(); controller = null; ++revision; busy = false; pendingLayout = null;
      root.SpireScreenshotEngine?.releaseWorker?.();
      cancel.hidden = true; progress.hidden = true;
      statusText.textContent = '已取消识别，保留上次完成的结果';
      if (showMessage) {
        if (source && !tiers.length) { tiers = [{key: ++serial, name: '档位 1', color: '#d6c08a', cards: []}]; lastTier = tiers[0].key; }
      }
      renderTiers();
    }
    async function applyResult() {
      updateStatus(); if (apply.disabled) return;
      // Normalize only the submitted copy; keep every crop available for optional review.
      const seen = new Set();
      const result = {title: titleInput.value.trim(), tiers: tiers.map(tier => ({name: tier.name.trim(), color: tier.color, cards: tier.cards.filter(item => {
        if (!byId.has(item.id) || seen.has(item.id)) return false;
        seen.add(item.id); return true;
      }).map(item => item.id)}))};
      applyBusy = true; updateStatus(); apply.textContent = '正在生成…';
      try { await onApply(result); close(); }
      catch (error) { statusText.textContent = error?.message || '未能生成排表，请重试'; }
      finally { applyBusy = false; apply.textContent = '生成排表'; updateStatus(); }
    }
    function open(options = {}) {
      const current = new Map(cards.map(card => [card.id, {...card, unavailableInVersion: true}]));
      for (const card of getCards()) current.set(card.id, card);
      byId = current;
      catalog = sortCatalog([...current.values()]);
      if (dialog.open) return;
      returnFocus = document.activeElement;
      if (!source && options.title) titleInput.value = String(options.title).slice(0, 80);
      dialog.showModal(); updateStatus(); renderSelectionTools();
    }
    function close() {
      hideHover(); closeBatch(); cancelEditor(); resetGesture(); abort(false); root.SpireScreenshotEngine?.releaseWorker?.(); if (dialog.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    }
    file.addEventListener('change', () => { const chosen = file.files[0]; file.value = ''; loadFile(chosen); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); blank.classList.add('ssi-drag-over'); } });
    dialog.addEventListener('dragleave', event => { if (!dialog.contains(event.relatedTarget)) blank.classList.remove('ssi-drag-over'); });
    dialog.addEventListener('drop', event => { if (!event.dataTransfer?.files.length) return; event.preventDefault(); blank.classList.remove('ssi-drag-over'); loadFile(event.dataTransfer.files[0]); });
    editor.addEventListener('cancel', event => { event.preventDefault(); cancelEditor(); });
    editor.addEventListener('close', () => { if (!editor.open && editorSession) cancelEditor(); if (!editor.open) restoreBatchFocus(selected); });
    batchDialog.addEventListener('cancel', event => { event.preventDefault(); closeBatch(); });
    batchDialog.addEventListener('close', () => { if (!batchDialog.open && batchKind) closeBatch(); });
    nameEditor.addEventListener('cancel', event => { event.preventDefault(); closeNameEditor(); });
    nameEditor.addEventListener('close', () => { if (nameEditor.open) return; nameEditorKey = null; restoreBatchFocus(Number(nameEditor.dataset.tierKey)); });
    const resizeObserver = new ResizeObserver(() => drawOverlay()); resizeObserver.observe(sourceStage);
    updateStatus();
    return {open, close};
  }
  root.SpireScreenshotImporter = {create};
})(window);
