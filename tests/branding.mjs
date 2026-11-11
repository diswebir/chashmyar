#!/usr/bin/env node
/** Validate committed logo assets without Pillow, Tauri or a Windows build. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; };
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const expectedPng = {
  'src-tauri/icons/32x32.png': 32,
  'src-tauri/icons/128x128.png': 128,
  'src-tauri/icons/128x128@2x.png': 256,
  'src-tauri/icons/256x256.png': 256,
  'src-tauri/icons/512x512.png': 512,
  'src-tauri/icons/icon.png': 1024,
};
const manifest = JSON.parse(readFileSync('assets/branding/asset-hashes.json', 'utf8'));
eq(manifest.source.path, 'assets/branding/chashmyar-logo-selected.png', 'approved master path');
eq(sha(readFileSync(manifest.source.path)), manifest.source.sha256, 'approved master checksum');
const expectedFiles = [...Object.keys(expectedPng), 'src-tauri/icons/icon.ico'].sort();
assert.deepEqual(Object.keys(manifest.generated).sort(), expectedFiles, 'manifest has exactly the expected icons');
checks++;
for (const path of expectedFiles) eq(sha(readFileSync(path)), manifest.generated[path], `manifest checksum: ${path}`);

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Decode the project's noninterlaced 8-bit RGBA PNGs using only Node built-ins.
function decodePng(data, expected, label) {
  ok(data.subarray(0, 8).equals(pngSignature), `${label}: PNG signature`);
  let offset = 8, header, ended = false;
  const chunks = [];
  while (offset + 12 <= data.length) {
    const len = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8);
    ok(offset + 12 + len <= data.length, `${label}: chunk within file`);
    const value = data.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') header = value;
    if (type === 'IDAT') chunks.push(value);
    offset += len + 12;
    if (type === 'IEND') { ended = true; break; }
  }
  ok(ended && header?.length === 13 && chunks.length > 0, `${label}: complete PNG`);
  eq(header.readUInt32BE(0), expected, `${label}: width`);
  eq(header.readUInt32BE(4), expected, `${label}: height`);
  ok(header[8] === 8 && header[9] === 6 && header[10] === 0 && header[11] === 0 && header[12] === 0,
    `${label}: noninterlaced 8-bit RGBA`);
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = expected * 4;
  eq(raw.length, expected * (stride + 1), `${label}: decoded scanline size`);
  const pixels = Buffer.alloc(expected * stride);
  for (let y = 0; y < expected; y++) {
    const filter = raw[y * (stride + 1)];
    ok(filter <= 4, `${label}: supported PNG filter`);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      const predict = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upLeft)][filter];
      pixels[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predict) & 255;
    }
  }
  let dark = 0, light = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, a] = pixels.subarray(i, i + 4);
    if (a > 200 && Math.max(r, g, b) < 110) dark++;
    if (a > 200 && Math.min(r, g, b) > 235) light++;
  }
  ok(pixels[3] < 8, `${label}: transparent rounded corner`);
  ok(dark >= expected * expected * 0.045, `${label}: visible dark eye`);
  ok(light >= expected * expected * 0.55, `${label}: white background for dark taskbars`);
  return pixels;
}

const pngPixels = new Map();
for (const [path, size] of Object.entries(expectedPng)) pngPixels.set(path, decodePng(readFileSync(path), size, path));
ok(pngPixels.get('src-tauri/icons/128x128@2x.png').equals(pngPixels.get('src-tauri/icons/256x256.png')),
  'the 256px PNG variants match');

const ico = readFileSync('src-tauri/icons/icon.ico');
ok(ico.length >= 6 && ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1, 'ICO header');
const count = ico.readUInt16LE(4);
eq(count, 7, 'ICO frame count');
const found = new Map();
const ranges = [];
for (let i = 0; i < count; i++) {
  const entry = 6 + 16 * i;
  ok(entry + 16 <= ico.length, 'ICO directory entry present');
  const width = ico[entry] || 256, height = ico[entry + 1] || 256;
  const bytes = ico.readUInt32LE(entry + 8), start = ico.readUInt32LE(entry + 12);
  eq(width, height, `ICO frame ${i} is square`);
  ok(!found.has(width), `ICO frame ${width} is unique`);
  ok(start >= 6 + 16 * count && bytes > 0 && start + bytes <= ico.length, `ICO frame ${width} bounds`);
  ranges.push([start, start + bytes]);
  found.set(width, decodePng(ico.subarray(start, start + bytes), width, `ICO ${width}px`));
}
assert.deepEqual([...found.keys()].sort((a, b) => a - b), [16, 24, 32, 48, 64, 128, 256]);
checks++;
ranges.sort((a, b) => a[0] - b[0]);
for (let i = 1; i < ranges.length; i++) ok(ranges[i - 1][1] <= ranges[i][0], 'ICO frames do not overlap');
for (const [size, path] of [[32, 'src-tauri/icons/32x32.png'], [128, 'src-tauri/icons/128x128.png'], [256, 'src-tauri/icons/256x256.png']]) {
  ok(found.get(size).equals(pngPixels.get(path)), `ICO ${size}px matches the standalone PNG`);
}
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
for (const name of ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.ico', 'icons/icon.png']) {
  ok(config.bundle.icon.includes(name), `Tauri bundle includes ${name}`);
}
ok(readFileSync('src-tauri/src/tray.rs', 'utf8').includes('default_window_icon()'), 'tray uses the application icon');
console.log(`✓ Branding: ${checks} checks, including PNGs, ICO sizes, checksums and Tauri references.`);
