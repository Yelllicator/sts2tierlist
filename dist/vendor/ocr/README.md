# Offline OCR resources

Pinned from official npm packages on 2026-09-30:

- Tesseract.js 7.0.0, Apache-2.0: https://registry.npmjs.org/tesseract.js/-/tesseract.js-7.0.0.tgz
- Tesseract.js-core 7.0.0, Apache-2.0: https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-7.0.0.tgz
- @tesseract.js-data/eng 1.0.0: https://registry.npmjs.org/@tesseract.js-data/eng/-/eng-1.0.0.tgz
- @tesseract.js-data/chi_sim 1.0.0: https://registry.npmjs.org/@tesseract.js-data/chi_sim/-/chi_sim-1.0.0.tgz

The language files are the official `4.0.0_best_int` LSTM-only distributions, not custom-trained data or target-specific dictionaries. Package metadata says MIT; the underlying Tesseract traineddata is covered by the accompanying upstream Apache-2.0 license. Original package metadata and distributed notices are retained under `licenses/`; upstream Leptonica BSD notice is included as well. Vendor bundles are unmodified. `local-worker.js` is this application's same-origin-only wrapper, not an upstream file.

Source/API references:

- https://github.com/naptha/tesseract.js/blob/v7.0.0/docs/api.md
- https://github.com/naptha/tesseract.js/blob/v7.0.0/src/createWorker.js
- https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md
- https://github.com/naptha/tessdata/blob/gh-pages/README.md
- https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE
- https://github.com/DanBloomberg/leptonica/blob/master/leptonica-license.txt

## Runtime files

The application creates a worker only when OCR is requested. Its direct reference to `local-worker.js` permits immediate termination even during language/core initialization. That wrapper loads the pinned `worker.min.js` and rejects fetch/importScripts destinations outside the application's origin. The message protocol follows the pinned 7.0.0 `createWorker` implementation; update the module and protocol tests together with any vendor version upgrade.

- `local-worker.js`
- `worker.min.js`
- `core/tesseract-core-lstm.wasm.js`
- `core/tesseract-core-simd-lstm.wasm.js`
- `core/tesseract-core-relaxedsimd-lstm.wasm.js`
- `lang/eng.traineddata.gz`
- `lang/chi_sim.traineddata.gz`

All six core variants and their `.wasm` counterparts are shipped so the pinned library retains its full supported core selection. Version 7 adds relaxed SIMD variants to the four-core list described in older documentation. The current `*.wasm.js` distributions embed the WASM binary and do not require a CDN. `tesseract.min.js` is retained as the upstream API distribution but the application uses the direct worker protocol to guarantee cancellation ownership.

`manifest.json` records packaged paths, exact bytes, SHA-256 hashes and origin package URLs. Copy the entire `vendor/ocr/` directory, including licenses and this source record, into every portable build. No npm, Python, installed Tesseract or internet connection is needed by the user.
