import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderToHTMLString } from '@tiptap/static-renderer';
import { articleExtensions, rowImageRatio } from '../shared/articleExtensions';
import { insertImageFiles } from '../src/insertImages';
import { uploadInlineImages } from '../src/share';
import { stableStringify } from '../shared/cloud';

const photos = [
  { src: 'data:image/gif;base64,R0lGODlh', width: 1200, height: 800 },
  { src: 'data:image/gif;base64,R0lGODli', width: 800, height: 1200 },
];
const documentWithRow = () => ({ type: 'doc', content: [{ type: 'imageRow', attrs: { images: structuredClone(photos), caption: 'A pair', radius: 8 } }] });

test('picking exactly two photos inserts one ordered imageRow through the real insertion pipeline', async (t) => {
  // Only browser decoding is stubbed; preparation and insertion execute normally.
  class FakeReader {
    result = ''; onload?: () => void;
    async readAsDataURL(file: Blob) { this.result = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`; this.onload?.(); }
  }
  class FakeImage {
    naturalWidth = 0; naturalHeight = 0; onload?: () => void;
    set src(value: string) { const im = photos.find(p => p.src === value)!; this.naturalWidth = im.width; this.naturalHeight = im.height; queueMicrotask(() => this.onload?.()); }
  }
  const oldReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  const oldImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: FakeReader });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
  t.after(() => {
    if (oldReader) Object.defineProperty(globalThis, 'FileReader', oldReader); else delete (globalThis as any).FileReader;
    if (oldImage) Object.defineProperty(globalThis, 'Image', oldImage); else delete (globalThis as any).Image;
  });
  let inserted: any[] = []; let runs = 0;
  const chain = { focus() { return this; }, insertContent(nodes: any[]) { inserted = nodes; return this; }, run() { runs++; } };
  const files = photos.map((p, i) => new File([Buffer.from(p.src.split(',')[1], 'base64')], `photo-${i}.gif`, { type: 'image/gif' }));
  assert.equal(await insertImageFiles({ chain: () => chain } as any, files), 2);
  assert.equal(runs, 1); assert.equal(inserted.length, 1); assert.equal(inserted[0].type, 'imageRow');
  assert.deepEqual(inserted[0].attrs.images, photos);
});

test('published static HTML retains both photos, proportions, dimensions, caption and radius', () => {
  const doc = documentWithRow();
  doc.content[0].attrs.images.forEach((im, i) => { im.src = `/i/${String(i + 1).repeat(64)}.gif`; });
  const html = renderToHTMLString({ extensions: articleExtensions, content: doc });
  assert.equal((html.match(/<figure/g) ?? []).length, 1);
  assert.equal((html.match(/<img /g) ?? []).length, 2);
  assert.match(html, /data-count="2"/); assert.match(html, /flex:1\.5000 1 0%/); assert.match(html, /flex:0\.6667 1 0%/);
  for (const im of doc.content[0].attrs.images) { assert.ok(html.includes(im.src)); assert.ok(html.includes(`width="${im.width}"`)); assert.ok(html.includes(`height="${im.height}"`)); }
  assert.match(html, /border-radius:8px/); assert.match(html, /<figcaption>A pair<\/figcaption>/);
});

test('aspect-proportional flex widths imply equal uncropped heights at desktop and mobile sizes', () => {
  const ratios = photos.map(rowImageRatio), sum = ratios.reduce((a, b) => a + b, 0);
  for (const [container, gap] of [[760, 8], [354, 4], [354, 8]]) {
    const heights = ratios.map((ratio, i) => ((container - gap) * ratio / sum) / (photos[i].width / photos[i].height));
    assert.ok(Math.abs(heights[0] - heights[1]) < 1e-9);
    assert.ok(heights.every(height => height > 0));
  }
});

test('editor and public CSS retain a non-wrapping proportional row on mobile', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.image-row-grid\s*\{[^}]*display:\s*flex;[^}]*gap:\s*8px;/);
  assert.match(css, /\.image-row-cell\s*\{[^}]*min-width:\s*0;/);
  assert.match(css, /\.image-row-cell img\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;/);
  const gridRules = [...css.matchAll(/[^{}]*\.image-row-grid[^{}]*\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(gridRules.every(rule => !/flex-direction:\s*column|flex-wrap:\s*wrap|display:\s*block/.test(rule)));
  assert.match(css, /\.image-row-grid\s*\{\s*gap:\s*4px;\s*\}/);
  assert.match(css, /\.shared-body \.image-row-grid\s*\{[^}]*display:\s*flex;[^}]*gap:\s*8px;/);
});

test('publication uploads both row assets without altering local originals; cloud JSON preserves exact row data', async (t) => {
  const local = documentWithRow(), original = structuredClone(local);
  const oldFetch = globalThis.fetch, oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const uploads: Uint8Array[] = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  globalThis.fetch = async (url, init) => {
    if (url === '/api/images/check') { assert.equal(JSON.parse(init!.body as string).hashes.length, 2); return Response.json({ existing: [] }); }
    assert.equal(url, '/api/images'); uploads.push(init!.body as Uint8Array);
    return Response.json({ url: `/i/${String(uploads.length).repeat(64)}.gif` });
  };
  t.after(() => { globalThis.fetch = oldFetch; if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as any).localStorage; });
  const published = await uploadInlineImages(local) as typeof local;
  assert.equal(uploads.length, 2);
  uploads.forEach((bytes, i) => assert.deepEqual(Buffer.from(bytes), Buffer.from(photos[i].src.split(',')[1], 'base64')));
  assert.deepEqual(local, original);
  assert.deepEqual(published.content[0].attrs.images.map(im => [im.width, im.height]), [[1200, 800], [800, 1200]]);
  assert.equal(published.content[0].attrs.images.length, 2);
  assert.deepEqual(JSON.parse(stableStringify(local)), original);
});
