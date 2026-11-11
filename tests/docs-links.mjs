#!/usr/bin/env node
/** Check local Markdown/HTML links in the committed project documentation. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const rootDocs = ['README.md', 'README.en.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md'];
function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}
const files = [...rootDocs, ...markdownFiles('docs'), ...markdownFiles('assets/branding')];
const failures = [];
let links = 0, checkedAnchors = 0;
function readableLines(file) {
  let inFence = false;
  const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return ''; }
    return inFence ? '' : line.replace(/`+[^`]*`+/g, '');
  });
}
function headingSlugs(file) {
  const counts = new Map(), slugs = new Set();
  for (const line of readableLines(file)) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const slug = match[1].replace(/<[^>]*>/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_~]/g, '').toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const previous = counts.get(slug) ?? 0;
    counts.set(slug, previous + 1);
    slugs.add(previous ? `${slug}-${previous}` : slug);
  }
  return slugs;
}
function check(file, line, raw) {
  if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) return;
  const [nameAndQuery, ...fragmentParts] = raw.split('#');
  const fragment = fragmentParts.join('#');
  let name, anchor;
  try {
    name = decodeURIComponent(nameAndQuery.split('?')[0]);
    anchor = decodeURIComponent(fragment);
  } catch {
    failures.push(`${file}:${line}: malformed URL encoding: ${raw}`); return;
  }
  const target = name ? resolve(dirname(file), name) : resolve(file);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || !existsSync(target) || !statSync(target).isFile()) {
    failures.push(`${file}:${line}: missing or outside repository: ${raw}`); return;
  }
  links++;
  if (anchor && target.endsWith('.md')) {
    checkedAnchors++;
    if (!headingSlugs(target).has(anchor)) failures.push(`${file}:${line}: unknown heading: ${raw}`);
  }
}
for (const file of files) {
  assert.ok(existsSync(file), `required documentation missing: ${file}`);
  const lines = readableLines(file);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]*)>|([^\s)]+))(?:\s+["'][^)]*["'])?\s*\)/g)) {
      check(file, index + 1, match[1] ?? match[2]);
    }
    for (const match of line.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) check(file, index + 1, match[1]);
  });
}
if (failures.length) {
  console.error('Documentation link errors:\n' + failures.map((failure) => `  ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`✓ Documentation: ${files.length} Markdown files, ${links} local links (${checkedAnchors} headings). External links are not fetched.`);
}
