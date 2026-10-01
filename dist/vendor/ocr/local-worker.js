/* Local-only boundary around the unmodified pinned Tesseract.js worker. */
'use strict';
const localOrigin = self.location.origin;
const originalFetch = self.fetch.bind(self);
const originalImport = self.importScripts.bind(self);
function localUrl(input) {
  const value = input instanceof Request ? input.url : input;
  const url = new URL(value, self.location.href);
  if (url.origin !== localOrigin) throw new Error('Offline OCR cannot access external resources');
  return url.href;
}
self.fetch = (input, options) => originalFetch(localUrl(input), options);
self.importScripts = (...urls) => originalImport(...urls.map(localUrl));
self.importScripts('./worker.min.js');
