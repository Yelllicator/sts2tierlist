'use strict';
((root) => {
  function contrast(hex) {
    const [r, g, b] = hex.slice(1).match(/../g).map(value => parseInt(value, 16));
    return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? '#241f16' : '#fff8eb';
  }
  function lines(context, text, width) {
    const result = [];
    for (const paragraph of String(text).split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (line && context.measureText(line + char).width > width) { result.push(line); line = ''; }
        line += char;
      }
      result.push(line);
    }
    return result;
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image(), timer = setTimeout(() => reject(Error('遗物图标加载超时，请重试。')), 15000);
      image.onload = () => { clearTimeout(timer); resolve(image); };
      image.onerror = () => { clearTimeout(timer); reject(Error('遗物图标无法加载，请刷新后重试。')); };
      image.src = src;
    });
  }
  async function render(state, byId, scale = 2) {
    if (![1, 1.5, 2].includes(scale)) throw Error('不支持的导出清晰度');
    const width = 1500, margin = 32, labelWidth = 160, gap = 10, columns = 11;
    const contentWidth = width - margin * 2 - labelWidth;
    const tileWidth = (contentWidth - gap * (columns + 1)) / columns;
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    if (!ctx) throw Error('浏览器无法创建图片画布');
    const font = size => size + 'px "Microsoft YaHei", system-ui, sans-serif';
    ctx.font = font(34);
    const titleLines = lines(ctx, state.title, width - margin * 2);
    let height = margin + titleLines.length * 46 + 46;
    ctx.font = font(19);
    const rows = state.tiers.map(tier => {
      ctx.font = font(19);
      const labelLines = lines(ctx, tier.name, labelWidth - 24);
      ctx.font = font(15);
      const items = state.rows[tier.id].map(id => ({relic: byId.get(id), nameLines: lines(ctx, byId.get(id).name, tileWidth - 6)}));
      const rowHeight = Math.max(116, labelLines.length * 27 + 26, Math.ceil(items.length / columns) * 130 + gap * 2);
      const row = {tier, items, labelLines, top: height, height: rowHeight};
      height += rowHeight + 1;
      return row;
    });
    height += 60;
    if (Math.ceil(width * scale) * Math.ceil(height * scale) > 48000000 || height * scale > 30000) throw Error('图片过长，请降低导出清晰度或减少评级文字。');
    const images = new Map(await Promise.all(rows.flatMap(row => row.items).map(async item => [item.relic.id, await loadImage(item.relic.image)])));
    canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale); ctx.scale(scale, scale);
    ctx.fillStyle = '#191711'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#f0ebdf'; ctx.font = font(34); ctx.textBaseline = 'top';
    titleLines.forEach((line, i) => ctx.fillText(line, margin, margin + i * 46));
    ctx.fillStyle = '#aca28b'; ctx.font = font(16);
    ctx.fillText('尖塔排表 · 遗物 · ' + state.gameVersion + ' · ' + images.size + ' 件已评级', margin, margin + titleLines.length * 46 + 8);
    rows.forEach((row, rowIndex) => {
      ctx.fillStyle = rowIndex % 2 ? '#252219' : '#201e17'; ctx.fillRect(margin, row.top, width - margin * 2, row.height);
      ctx.fillStyle = row.tier.color; ctx.fillRect(margin, row.top, labelWidth, row.height);
      ctx.fillStyle = contrast(row.tier.color); ctx.font = font(19); ctx.textAlign = 'center';
      row.labelLines.forEach((line, i) => ctx.fillText(line, margin + labelWidth / 2, row.top + (row.height - row.labelLines.length * 27) / 2 + i * 27));
      row.items.forEach((item, i) => {
        const x = margin + labelWidth + gap + (i % columns) * (tileWidth + gap);
        const y = row.top + gap + Math.floor(i / columns) * 130;
        const image = images.get(item.relic.id), ratio = Math.min(76 / image.naturalWidth, 76 / image.naturalHeight);
        const iw = image.naturalWidth * ratio, ih = image.naturalHeight * ratio;
        ctx.drawImage(image, x + (tileWidth - iw) / 2, y + (76 - ih) / 2, iw, ih);
        ctx.fillStyle = '#f0ebdf'; ctx.font = font(15);
        item.nameLines.slice(0, 3).forEach((line, j) => ctx.fillText(line, x + tileWidth / 2, y + 80 + j * 17));
      });
    });
    ctx.textAlign = 'left'; ctx.font = font(14); ctx.fillStyle = '#aca28b';
    ctx.fillText('Slay the Spire 2 · 游戏图文 © Mega Crit', margin, height - 36);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw Error('图片生成失败，请降低清晰度后重试。');
    const result = {blob, width: canvas.width, height: canvas.height};
    canvas.width = canvas.height = 1;
    return result;
  }
  root.SpireRelicExport = {render, contrast};
})(globalThis);
