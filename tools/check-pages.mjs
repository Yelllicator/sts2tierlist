// Static deployment preflight. No dependencies, network, builds or browser storage writes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const publishedCopy = Boolean(process.argv[2]);
const publicRepository = process.argv.includes('--public-repo');
const dist = publishedCopy ? path.resolve(root, process.argv[2]) : path.join(root, 'dist');
const siteBase = new URL('https://pages.invalid/sts2tierlist/');
// Keep in sync with tools/prepare-pages.mjs.
const excluded = new Set(['reference.png']);
const forbiddenParts = new Set(['.git', '.env', '.staging', 'assets-provenance', 'tests', 'backups', 'releases']);
const publicRoots = new Set(['dist', 'tools', '.github', 'README.md', 'SOURCES.md', 'package.json', '.gitattributes', '.public-release.json']);
const runtimeFiles = new Set([
  'app.js', 'cards.js', 'card-versions.js', 'versions.js', 'model.js', 'pool-sort.js', 'export.js',
  'scheme-store.js', 'scheme-library.js', 'screenshot-engine.js', 'screenshot-import.js', 'screenshot-ocr.js',
  'index.html', 'favicon.svg', 'style.css', 'scheme-library.css', 'screenshot-import.css',
  'images/thumbs/manifest.json', 'recognition/index.json', 'recognition/README.txt',
  'vendor/ocr/local-worker.js', 'vendor/ocr/manifest.json', 'vendor/ocr/README.md'
]);
function checkTextPrivacy(source, file) {
  // Emscripten uses this generic virtual home inside its unchanged upstream
  // runtime. It is not a path on the publisher's machine.
  const text = file.startsWith('vendor/ocr/core/') ? source.replace(/\/home\/web_user(?=[\/"'\s\0]|$)/g, '/virtual-home') : source;
  assert.ok(!/(?:^|[\s"'`(=])[a-z]:[\\/]{1,2}/im.test(text), `Local drive path in ${file}`);
  assert.ok(!/(?:^|[\s"'`(=])\/(?:Users|home)\/[\w.-]+(?:[\\/]|(?=["'\s)]|$))/m.test(text), `Local user path in ${file}`);
  assert.ok(!/(?:^|[\s"'`(=])\/mnt\/[a-z]\/Users\//im.test(text), `Local mounted user path in ${file}`);
}
const files = new Map();
function walk(directory, prefix = '') {
  for (const name of readdirSync(directory)) {
    const relative = prefix + name;
    if (publishedCopy) assert.ok(!relative.split('/').some(part => forbiddenParts.has(part) || part.startsWith('.env.')), `Private file path in publishing copy: ${relative}`);
    if (excluded.has(relative)) continue;
    const full = path.join(directory, name), stat = lstatSync(full);
    assert.ok(!stat.isSymbolicLink(), `Pages cannot publish a symbolic link: ${relative}`);
    if (stat.isDirectory()) walk(full, relative + '/');
    else {
      assert.ok(stat.isFile(), `Not a regular file: ${relative}`);
      assert.equal(stat.nlink, 1, `Pages cannot publish a hard link: ${relative}`);
      assert.ok(stat.size <= 100 * 1024 * 1024, `GitHub rejects files over 100 MiB: ${relative}`);
      files.set(relative, stat);
      if (publishedCopy && /\.(?:js|json|css|html|svg|md|txt)$/i.test(name)) checkTextPrivacy(readFileSync(full, 'utf8'), relative);
    }
  }
}
walk(dist);
if (publishedCopy) assert.ok(!readdirSync(dist).includes('reference.png'), 'Reference image must not be in the publishing copy');
const total = [...files.values()].reduce((sum, stat) => sum + stat.size, 0);
// Conservative decimal interpretation of GitHub's published-site 1 GB limit.
assert.ok(total < 1_000_000_000, `Published site exceeds 1 GB: ${total} bytes`);
const read = file => readFileSync(path.join(dist, file), 'utf8');
let references = 0;
function checkReference(value, source = 'index.html', allowDirectory = false) {
  assert.equal(typeof value, 'string', `Missing resource path in ${source}`);
  assert.ok(value.length > 0 && !/^(?:\/|\\|[a-z][a-z\d+.-]*:)/i.test(value), `Resource must be relative: ${source} -> ${value}`);
  assert.ok(!value.includes('\\'), `Use URL slashes: ${source} -> ${value}`);
  const url = new URL(value, new URL(source, siteBase));
  assert.ok(url.origin === siteBase.origin && url.pathname.startsWith(siteBase.pathname), `Resource escapes project subpath: ${source} -> ${value}`);
  let relative = decodeURIComponent(url.pathname.slice(siteBase.pathname.length));
  if (allowDirectory && (!relative || relative.endsWith('/'))) relative += 'index.html';
  assert.ok(files.has(relative), `Missing resource (case-sensitive): ${source} -> ${relative}`);
  references++;
  return relative;
}

const html = read('index.html');
assert.ok(!/<base\b/i.test(html), 'Project pages must not override relative URL resolution with <base>');
for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
  if (!match[1] || match[1].startsWith('#') || /^(?:https?:|mailto:|data:)/i.test(match[1])) continue;
  checkReference(match[1], 'index.html', true);
}
for (const file of files.keys()) {
  if (!file.endsWith('.css')) continue;
  for (const match of read(file).matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) {
    if (/^(?:data:|#)/i.test(match[1])) continue;
    checkReference(match[1], file);
  }
}

// Inspect only runtime image fields; provenance metadata is not a browser URL.
const scope = {window: {}};
for (const file of ['cards.js', 'card-versions.js']) vm.runInNewContext(read(file), scope, {filename: file, timeout: 10000});
const catalogs = [scope.window.CARD_DATA, ...scope.window.CARD_VERSIONS.map(version => version.cards)];
if (publishedCopy) {
  assert.ok(!Object.hasOwn(scope.window, 'REFERENCE_LAYOUT'), 'Publishing copy contains historical reference rankings');
  for (const card of scope.window.CARD_DATA) {
    assert.ok(!Object.hasOwn(card, 'faceZh') && !Object.hasOwn(card, 'faceEn'), 'Publishing copy contains local artwork source paths');
  }

  // These checks use synthetic rows, not private reference layouts or fixtures.
  for (const file of ['versions.js', 'model.js']) vm.runInNewContext(read(file), scope, {filename: file, timeout: 10000});
  const catalog = scope.SpireCardVersions.create(scope.window.CARD_DATA, scope.window.CARD_VERSIONS);
  const model = scope.SpireBoardModel.createModel(catalog.getAllCards(), undefined, catalog);
  assert.equal(catalog.defaultVersion, '0.111.0', 'Unexpected default game version');
  for (const template of scope.SpireBoardModel.TEMPLATES) {
    const board = model.createTemplate(template.id);
    assert.equal(board.gameVersion, '0.111.0');
    assert.ok(board.tiers.every(tier => board.rows[tier.id].length === 0), `Nonempty default ranking: ${template.id}`);
  }
  const legacy = model.createTemplate('silent', 'en', catalog.legacyVersion);
  const cardId = legacy.rows.pool[0];
  for (const row of Object.keys(legacy.rows)) legacy.rows[row] = [];
  legacy.rows.s = [cardId];
  const restored = model.validate({version: 1, rows: legacy.rows});
  assert.equal(restored.gameVersion, catalog.legacyVersion);
  assert.equal(JSON.stringify(restored.rows), JSON.stringify(legacy.rows), 'Legacy import changed explicit card membership');
}
let cardImages = 0;
for (const cards of catalogs) {
  for (const card of cards) {
    for (const field of ['imageZh', 'imageEn', 'thumbZh', 'thumbEn']) {
      checkReference(card[field]);
      cardImages++;
    }
  }
}

// Dynamic worker dependencies do not appear as HTML tags or card URLs.
checkReference('recognition/index.json', 'screenshot-engine.js');
checkReference('vendor/ocr/local-worker.js', 'screenshot-ocr.js');
checkReference('./worker.min.js', 'vendor/ocr/local-worker.js');
const manifest = JSON.parse(read('vendor/ocr/manifest.json'));
for (const item of manifest.files) {
  const relative = checkReference(item.path, 'vendor/ocr/manifest.json');
  const bytes = readFileSync(path.join(dist, relative));
  assert.equal(bytes.length, item.bytes, `OCR resource size changed: ${relative}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, `OCR resource hash changed: ${relative}`);
  runtimeFiles.add(relative);
}
if (publishedCopy) {
  const legacyIds = new Set(scope.window.CARD_DATA.map(card => card.id));
  const versionIds = new Map(scope.window.CARD_VERSIONS.map(version => [version.id, new Set(version.cards.map(card => card.id))]));
  for (const file of files.keys()) {
    if (runtimeFiles.has(file)) continue;
    const legacy = /^images\/(?:(?:ancient-v6\/)?(?:thumbs\/)?(?:zh|en)\/)?([a-z0-9-]+)\.webp$/.exec(file);
    if (legacy && legacyIds.has(legacy[1])) continue;
    const versioned = /^assets\/cards\/versions\/v([\d.]+)\/(?:thumbs\/)?(?:zh|en)\/([a-z0-9-]+)\.webp$/.exec(file);
    assert.ok(versioned && versionIds.get(versioned[1])?.has(versioned[2]), `File outside the public runtime allowlist: ${file}`);
  }
}
// Catch common subpath regressions in maintained scripts. This is a targeted
// static check, not a JavaScript parser or a replacement for browser acceptance.
for (const file of files.keys()) {
  if (file.includes('/') || !file.endsWith('.js') || ['cards.js', 'card-versions.js'].includes(file)) continue;
  const source = read(file);
  assert.ok(!/["'`](?:\/(?:assets|images|recognition|vendor)\/|https?:\/\/(?:localhost|127\.0\.0\.1)(?=[:/]))/i.test(source), `Root-relative asset or local-server URL in ${file}`);
  assert.ok(!/["'`]reference\.png["'`]/.test(source), `${file} still references the excluded private reference image`);
}

if (publicRepository) {
  assert.ok(publishedCopy, 'Public repository checks require an explicit dist directory');
  for (const name of readdirSync(root)) {
    if (name === '.git') continue; // Existing public-repository metadata is never copied or inspected.
    assert.ok(publicRoots.has(name), `Unexpected file in public repository: ${name}`);
  }
  for (const directory of ['tools', '.github/workflows']) {
    const expected = directory === 'tools' ? ['check-pages.mjs'] : ['pages.yml'];
    assert.equal(JSON.stringify(readdirSync(path.join(root, directory)).sort()), JSON.stringify(expected), `Unexpected files in ${directory}`);
  }
  assert.equal(JSON.stringify(readdirSync(path.join(root, '.github'))), JSON.stringify(['workflows']));
  for (const file of ['README.md', 'SOURCES.md', 'package.json', '.gitattributes', '.public-release.json', 'tools/check-pages.mjs', '.github/workflows/pages.yml']) {
    const full = path.join(root, file), stat = lstatSync(full);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, `Unsafe public repository file: ${file}`);
    checkTextPrivacy(readFileSync(full, 'utf8'), file);
  }
  for (const directory of ['dist', 'tools', '.github', '.github/workflows']) assert.ok(!lstatSync(path.join(root, directory)).isSymbolicLink(), `Unsafe public repository directory: ${directory}`);
}

console.log(`Pages preflight passed: ${files.size} files, ${(total / 1024 ** 2).toFixed(1)} MiB (${total} bytes).`);
console.log(`Checked ${references} relative references under /sts2tierlist/, including ${cardImages} card image paths and ${manifest.files.length} pinned OCR files.`);
console.log(publishedCopy ? 'Public copy contains no reference rankings or local artwork paths; default and legacy-import checks passed.' : 'Source check only: private metadata is allowed here and must be removed from any publishing copy.');
console.log('Browser interaction and live GitHub hosting require separate acceptance.');
