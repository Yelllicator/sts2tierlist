'use strict';
window.SpireExportQr = (() => {
  // https://yelllicator.github.io/sts2tierlist/
  // QR version 4-Q, generated with Python qrcode 8.2. The four-module quiet zone is drawn below.
  const modules = [
    '111111100111110100111101001111111',
    '100000101010001101000011001000001',
    '101110101001011000101000101011101',
    '101110100110101010100011101011101',
    '101110100000010000100110101011101',
    '100000100111000010000010101000001',
    '111111101010101010101010101111111',
    '000000000010000011110011000000000',
    '011101100111001011100101000000110',
    '110011000110001001011101001101101',
    '111100110111111100101101001111011',
    '011001000001110111001010101101000',
    '011100111010110110010011110011010',
    '101111011011101101001000110101010',
    '111010101000010110111110001100100',
    '100001011111101011111110011010100',
    '111111101111010101111111011011100',
    '111100011010100110100111101011001',
    '000110111110100011000110110110110',
    '011001011001011110111001101010001',
    '000010111010010011110101100001111',
    '110111001010110101110101011101001',
    '001110110010111001001001000111111',
    '010010001011100100111001000101001',
    '101111101000001110101010111110001',
    '000000001101000111110111100011000',
    '111111100011001110011011101010000',
    '100000101110010011111111100011100',
    '101110100101100110110111111110111',
    '101110101010111110001001000100111',
    '101110101010010001001111101101100',
    '100000101101011011111000101110001',
    '111111100111001101110100001010100',
  ];
  const quietZone = 4;
  const moduleSize = 3;
  const size = (modules.length + quietZone * 2) * moduleSize;
  const minHeaderHeight = size + 36;
  const titleGap = 24;

  function draw(ctx, right, headerHeight, scale) {
    const edge = cell => Math.round(cell * moduleSize * scale);
    const pixels = Math.round(size * scale);
    const left = Math.round(right * scale) - pixels;
    const top = Math.round((headerHeight - size) * scale / 2);

    ctx.save();
    // Snap module edges to device pixels, including fractional export scales.
    ctx.setTransform(1, 0, 0, 1, left, top);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, pixels, pixels);
    ctx.fillStyle = '#000';
    modules.forEach((row, y) => {
      const cellY = y + quietZone;
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== '1') continue;
        const cellX = x + quietZone;
        ctx.fillRect(edge(cellX), edge(cellY), edge(cellX + 1) - edge(cellX), edge(cellY + 1) - edge(cellY));
      }
    });
    ctx.restore();
  }

  return {size, minHeaderHeight, titleGap, draw};
})();
