/** Collect and verify the current Windows installer/portable pair.
 * Previously delivered versions stay in place so existing download links work.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const VERIFY_ONLY = process.argv.includes("--verify");
const ROOT = process.cwd();
const TARGET = join(ROOT, "src-tauri/target/x86_64-pc-windows-msvc/release");
const OUT = join(ROOT, "release/windows");
const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const installer = `ChashmYar_${version}_x64-setup.exe`;
const portable = `ChashmYar-${version}-portable.exe`;
const expected = [installer, portable];

const fail = (msg) => { console.error("✗ " + msg); process.exit(1); };

if (!VERIFY_ONLY) {
  const setupSource = join(TARGET, "bundle/nsis", installer);
  const portableSource = join(TARGET, "chashmyar.exe");
  if (!existsSync(setupSource)) fail(`installer not found: ${setupSource}`);
  if (!existsSync(portableSource)) fail(`portable not found: ${portableSource}`);
  mkdirSync(OUT, { recursive: true });
  copyFileSync(setupSource, join(OUT, installer));
  copyFileSync(portableSource, join(OUT, portable));
  console.log(`✓ installer  → release/windows/${installer}`);
  console.log(`✓ portable   → release/windows/${portable}`);
}

if (!existsSync(OUT)) fail("release/windows does not exist");
const files = readdirSync(OUT);
const wrong = files.filter((f) => !f.endsWith(".exe"));
if (wrong.length) fail("non-.exe files in release/windows: " + wrong.join(", "));
for (const name of expected) {
  if (!files.includes(name)) fail(`missing ${name}`);
  const path = join(OUT, name);
  const buf = readFileSync(path);
  if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) fail(`${name} is not a PE/MZ executable`);
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 26 > buf.length || buf.toString("binary", pe, pe + 4) !== "PE\0\0") fail(`${name} has no valid PE header`);
  const machine = buf.readUInt16LE(pe + 4);
  if (name === portable && machine !== 0x8664) fail(`${name} is not x86-64`);
  // NSIS uses an x86 stub even when the installed app is x64.
  if (name === installer && machine !== 0x14c && machine !== 0x8664) fail(`${name} has an unexpected installer stub architecture`);
  const hash = createHash("sha256").update(buf).digest("hex");
  console.log(`✓ ${name}  ${statSync(path).size} B  ${hash}`);
}
console.log(`✓ current v${version} installer and portable verified; ${files.length - expected.length} older executable(s) retained`);
