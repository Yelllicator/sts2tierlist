/* Offline tier-label OCR. Tesseract.js 7.0.0 and all resources are pinned locally. */
'use strict';
(function (root) {
  const scriptUrl = typeof document !== 'undefined' ? document.currentScript?.src : '';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const abortError = () => { const error = new Error('文字识别已取消'); error.name = 'AbortError'; return error; };
  const check = signal => { if (signal?.aborted) throw abortError(); };
  let active = null, generation = 0;

  function originalStripPlan(original, tiers) {
    if (!original || ![original.width, original.height, original.analysisWidth, original.analysisHeight].every(n => Number.isFinite(n) && n > 0)) return null;
    if (original.width * original.height > 96000000 || Math.max(original.width, original.height) > 30000) return null;
    const sx = original.width / original.analysisWidth, sy = original.height / original.analysisHeight;
    const boxes = tiers.map(tier => {
      const b = tier.labelBox;
      if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) return null;
      const x = clamp(b.x * sx, 0, original.width), y = clamp(b.y * sy, 0, original.height);
      const right = clamp((b.x + b.width) * sx, x, original.width), bottom = clamp((b.y + b.height) * sy, y, original.height);
      return right > x && bottom > y ? {x, y, width: right - x, height: bottom - y} : null;
    });
    const valid = boxes.filter(Boolean); if (!valid.length) return null;
    const x = Math.floor(Math.min(...valid.map(b => b.x))), y = Math.floor(Math.min(...valid.map(b => b.y)));
    const width = Math.ceil(Math.max(...valid.map(b => b.x + b.width))) - x;
    const height = Math.ceil(Math.max(...valid.map(b => b.y + b.height))) - y;
    const scale = Math.min(1, 12000 / Math.max(width, height), Math.sqrt(12000000 / (width * height)));
    return {crop: {x, y, width, height}, resizeWidth: Math.max(1, Math.floor(width * scale)), resizeHeight: Math.max(1, Math.floor(height * scale)), boxes};
  }

  function originalStripTiers(plan, tiers, width = plan.resizeWidth, height = plan.resizeHeight) {
    const sx = width / plan.crop.width, sy = height / plan.crop.height;
    return tiers.map((tier, i) => ({...tier, labelBox: plan.boxes[i] ? {
      x: (plan.boxes[i].x - plan.crop.x) * sx, y: (plan.boxes[i].y - plan.crop.y) * sy,
      width: plan.boxes[i].width * sx, height: plan.boxes[i].height * sy
    } : null}));
  }

  function decodeStrip(blob, plan, signal) {
    check(signal);
    return new Promise((resolve, reject) => {
      let cancelled = false;
      const abort = () => { cancelled = true; reject(abortError()); };
      signal?.addEventListener('abort', abort, {once: true});
      const {x, y, width, height} = plan.crop;
      createImageBitmap(blob, x, y, width, height, {resizeWidth: plan.resizeWidth, resizeHeight: plan.resizeHeight, resizeQuality: 'high'}).then(bitmap => {
        signal?.removeEventListener('abort', abort);
        if (cancelled || signal?.aborted) { bitmap.close(); return; }
        resolve(bitmap);
      }, error => { signal?.removeEventListener('abort', abort); if (!cancelled) reject(error); });
    });
  }

  async function originalStrip(original, tiers, signal) {
    const plan = originalStripPlan(original, tiers);
    if (!plan || !original.blob || typeof createImageBitmap !== 'function') return null;
    let bitmap = null, canvas = null, transferred = false;
    try {
      bitmap = await decodeStrip(original.blob, plan, signal); check(signal);
      canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', {willReadFrequently: true}); ctx.drawImage(bitmap, 0, 0);
      const result = {canvas, image: ctx.getImageData(0, 0, canvas.width, canvas.height), tiers: originalStripTiers(plan, tiers, canvas.width, canvas.height)};
      transferred = true; return result;
    } finally {
      bitmap?.close(); if (canvas && !transferred) { canvas.width = 1; canvas.height = 1; }
    }
  }

  function normalizeText(value) {
    return String(value || '').replace(/\r\n?/g, '\n').replace(/[\u200b-\u200d\ufeff]/g, '')
      .split('\n').map(line => line.replace(/[\t\u00a0 ]+/g, ' ').trim().replace(/(\p{Script=Han}) +(?=\p{Script=Han})/gu, '$1')).filter(Boolean).join('\n').trim();
  }

  // Independent of the DOM so the identical preprocessing can be tested in Node.
  function prepareLabel(image, box) {
    if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;
    const inset = Math.max(2, Math.round(box.width * .018));
    const verticalInset = Math.min(Math.floor(box.height * .15), Math.max(5, Math.round(box.width * .045)));
    const left = clamp(Math.floor(box.x + inset), 0, image.width), top = clamp(Math.floor(box.y + verticalInset), 0, image.height);
    const right = clamp(Math.ceil(box.x + box.width - inset), left, image.width), bottom = clamp(Math.ceil(box.y + box.height - verticalInset), top, image.height);
    const width = right - left, height = bottom - top;
    if (width < 5 || height < 5 || width * height > 8000000) return null;
    const bins = new Map();
    for (let y = top; y < bottom; y += 3) for (let x = left; x < right; x += 3) {
      const i = (y * image.width + x) * 4, c = [image.data[i], image.data[i + 1], image.data[i + 2]];
      const key = c.map(v => Math.round(v / 16)).join(',');
      const b = bins.get(key) || {count: 0, sum: [0, 0, 0]}; b.count++; c.forEach((v, k) => b.sum[k] += v); bins.set(key, b);
    }
    const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
    if (!dominant) return null;
    const bg = dominant.sum.map(v => v / dominant.count), bgLum = bg[0] * .2126 + bg[1] * .7152 + bg[2] * .0722;
    const mask = new Uint8Array(width * height), rows = new Uint32Array(height), columns = new Uint32Array(width);
    let total = 0, peakContrast = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = ((top + y) * image.width + left + x) * 4;
      const rgb = [image.data[i], image.data[i + 1], image.data[i + 2]];
      const lum = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      const contrast = bgLum > 125 ? bgLum - lum : lum - bgLum;
      const distance = rgb.reduce((sum, v, k) => sum + Math.abs(v - bg[k]), 0);
      if (contrast > 30 && distance > 85) { mask[y * width + x] = 1; rows[y]++; columns[x]++; total++; peakContrast = Math.max(peakContrast, contrast); }
    }
    if (total < 5) return null;
    const xs = [], ys = []; for (let x = 0; x < width; x++) if (columns[x] >= 2) xs.push(x); for (let y = 0; y < height; y++) if (rows[y] >= 2) ys.push(y);
    if (!xs.length || !ys.length) return null;
    const x0 = xs[0], x1 = xs.at(-1) + 1, y0 = ys[0], y1 = ys.at(-1) + 1;
    const bands = []; let start = -1, last = -1;
    for (let y = y0; y <= y1 + 1; y++) {
      if (y < height && rows[y] >= 2) { if (start < 0) start = y; last = y; }
      else if (start >= 0 && y - last > 1) { if (last - start >= 2) bands.push([start, last + 1]); start = -1; }
    }
    const glyphHeight = [...bands].map(b => b[1] - b[0]).sort((a, b) => a - b)[Math.floor(bands.length / 2)] || y1 - y0;
    const preferredScale = clamp(Math.ceil(42 / Math.max(1, glyphHeight)), 2, 5);
    const scale = Math.min(preferredScale, Math.max(1, Math.floor(Math.sqrt(1800000 / ((x1 - x0) * (y1 - y0)))))), padding = 18;
    const outWidth = (x1 - x0) * scale + padding * 2, outHeight = (y1 - y0) * scale + padding * 2;
    const data = new Uint8ClampedArray(outWidth * outHeight * 4); data.fill(255);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const original = ((top + y) * image.width + left + x) * 4;
      const lum = image.data[original] * .2126 + image.data[original + 1] * .7152 + image.data[original + 2] * .0722;
      const contrast = bgLum > 125 ? bgLum - lum : lum - bgLum;
      const shade = contrast < 12 ? 255 : Math.round(255 - clamp(contrast / Math.max(1, peakContrast * .9), 0, 1) * 255);
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const i = (((y - y0) * scale + padding + dy) * outWidth + (x - x0) * scale + padding + dx) * 4;
        data[i] = data[i + 1] = data[i + 2] = shade;
      }
    }
    const single = bands.length <= 1, isCharacter = single && (x1 - x0) / Math.max(1, y1 - y0) < 1.4;
    return {width: outWidth, height: outHeight, data, psm: isCharacter ? '10' : single ? '7' : '6', lineCount: bands.length, sourceBox: {x: left + x0, y: top + y0, width: x1 - x0, height: y1 - y0}};
  }

  async function recognizeLabels(image, tiers, run, options = {}) {
    const labels = [], warnings = [], emit = options.onProgress || (() => {});
    for (let i = 0; i < tiers.length; i++) {
      check(options.signal); emit({phase: 'ocr', progress: i / Math.max(1, tiers.length), message: `识别评级文字 ${i + 1} / ${tiers.length}`});
      const prepared = prepareLabel(image, tiers[i].labelBox);
      if (!prepared) { labels.push({text: '', confidence: 0, needsReview: true}); continue; }
      let data = await run(prepared, prepared.psm); check(options.signal);
      let text = normalizeText(data?.text), confidence = clamp(Number(data?.confidence) || 0, 0, 100);
      // Generic segmentation fallback only: no template labels, target text or custom dictionary.
      if (!text || confidence < 75) {
        const alternative = await run(prepared, prepared.psm === '10' ? '8' : '11'); check(options.signal);
        const altText = normalizeText(alternative?.text), altConfidence = clamp(Number(alternative?.confidence) || 0, 0, 100);
        if (altText && (!text || altConfidence > confidence)) { data = alternative; text = altText; confidence = altConfidence; }
      }
      const words = (data?.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => (paragraph.lines || []).flatMap(line => line.words || [])));
      const uncertainWord = words.some(word => /[\p{L}\p{N}]/u.test(word.text || '') && Number(word.confidence) < 70);
      labels.push({text, confidence, needsReview: !text || confidence < 85 || uncertainWord});
      if (text.length > 300) warnings.push(`第 ${i + 1} 档文字超过 300 字，请校对后缩短`);
    }
    emit({phase: 'ocr', progress: 1, message: '评级文字识别完成'});
    if (labels.some(label => !label.text)) warnings.push('部分评级文字未识别，请手动填写');
    return {labels, warnings};
  }

  // This is the pinned 7.0.0 createWorker message protocol. Holding the native
  // worker immediately lets cancellation terminate initialization as well as OCR.
  function localWorker(baseUrl, signal, emit) {
    const worker = new Worker(new URL('local-worker.js', baseUrl), {name: 'Spire tier label OCR'});
    const pending = new Map(); let serial = 0, stopped = false;
    function terminate(reason = abortError()) {
      if (stopped) return; stopped = true; worker.terminate(); signal?.removeEventListener('abort', abort);
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(reason); } pending.clear();
    }
    const abort = () => terminate(abortError()); signal?.addEventListener('abort', abort, {once: true});
    worker.onerror = event => terminate(new Error(event.message || '本地文字识别组件加载失败'));
    worker.onmessage = event => {
      const message = event.data, key = `${message.action}-${message.jobId}`, task = pending.get(key);
      if (message.status === 'progress') { emit?.(message.data); return; }
      if (!task) return;
      clearTimeout(task.timer); pending.delete(key);
      if (message.status === 'resolve') task.resolve(message.data);
      else task.reject(new Error(String(message.data || '文字识别失败')));
    };
    function request(action, payload) {
      check(signal); if (stopped) return Promise.reject(abortError());
      const jobId = `tier-ocr-${++serial}`, key = `${action}-${jobId}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => terminate(new Error('文字识别超时，请重试或手动填写')), 45000);
        pending.set(key, {resolve, reject, timer}); worker.postMessage({workerId: 'local-tier-ocr', jobId, action, payload});
      });
    }
    if (signal?.aborted) abort();
    return {request, terminate};
  }

  async function recognize(canvas, tiers, options = {}) {
    check(options.signal);
    if (!Array.isArray(tiers) || !tiers.length) return {labels: [], warnings: []};
    const thisGeneration = ++generation;
    const checkCurrent = () => { check(options.signal); if (thisGeneration !== generation) throw abortError(); };
    if (active) active.terminate();
    const fallback = () => ({labels: tiers.map(() => ({text: '', confidence: 0, needsReview: true})), warnings: ['文字识别暂不可用，请手动填写评级名称']});
    let rpc = null, scratch = null, strip = null;
    try {
      if (!canvas?.getContext || !canvas.width || !canvas.height || canvas.width * canvas.height > 96000000) throw new Error('截图无效');
      let image = null, ocrTiers = tiers;
      if (options.original && (options.original.width > options.original.analysisWidth || options.original.height > options.original.analysisHeight)) {
        try { strip = await originalStrip(options.original, tiers, options.signal); }
        catch (error) { if (error?.name === 'AbortError' || options.signal?.aborted) throw abortError(); }
        checkCurrent();
      }
      if (strip) { image = strip.image; ocrTiers = strip.tiers; }
      else image = canvas.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, canvas.width, canvas.height);
      const baseUrl = new URL('vendor/ocr/', scriptUrl || root.location.href);
      if (baseUrl.origin !== root.location.origin) throw new Error('文字识别资源必须位于本机网站');
      options.onProgress?.({phase: 'ocr', progress: 0, message: '加载本地中英文识别…'});
      rpc = localWorker(baseUrl, options.signal); active = rpc;
      await rpc.request('load', {options: {lstmOnly: true, corePath: new URL('core/', baseUrl).href, logging: false}});
      await rpc.request('loadLanguage', {langs: ['eng', 'chi_sim'], options: {langPath: new URL('lang', baseUrl).href, gzip: true, cacheMethod: 'none', lstmOnly: true}});
      await rpc.request('initialize', {langs: ['eng', 'chi_sim'], oem: 1, config: {}});
      await rpc.request('setParameters', {params: {user_defined_dpi: '300', preserve_interword_spaces: '0'}});
      scratch = document.createElement('canvas');
      const result = await recognizeLabels(image, ocrTiers, async (prepared, psm) => {
        check(options.signal); scratch.width = prepared.width; scratch.height = prepared.height;
        scratch.getContext('2d').putImageData(new ImageData(prepared.data, prepared.width, prepared.height), 0, 0);
        const blob = await new Promise(resolve => scratch.toBlob(resolve, 'image/png')); check(options.signal);
        if (!blob) throw new Error('文字裁图失败');
        const bytes = new Uint8Array(await blob.arrayBuffer()); check(options.signal);
        return rpc.request('recognize', {image: bytes, options: {tessedit_pageseg_mode: psm}, output: {text: true, blocks: true}});
      }, options);
      checkCurrent(); return result;
    } catch (error) {
      if (error?.name === 'AbortError' || options.signal?.aborted || thisGeneration !== generation) throw abortError();
      return fallback();
    } finally {
      rpc?.terminate(); if (active === rpc) active = null;
      if (scratch) { scratch.width = 1; scratch.height = 1; }
      if (strip) { strip.canvas.width = 1; strip.canvas.height = 1; }
    }
  }
  const api = {recognize, _test: {prepareLabel, recognizeLabels, normalizeText, originalStripPlan, originalStripTiers}};
  root.SpireScreenshotOCR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
