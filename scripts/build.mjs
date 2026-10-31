// Zero-dependency static site bundler for GitHub Pages (outputs self-contained ./dist directory)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sPath = path.join(src, entry.name);
    const dPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(sPath, dPath);
    } else {
      fs.copyFileSync(sPath, dPath);
    }
  }
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
copyDirRecursive(path.join(ROOT, 'src'), path.join(DIST, 'src'));
copyDirRecursive(path.join(ROOT, 'public'), path.join(DIST, 'public'));
// Also copy public/templates to dist/templates so both ./public/templates/* and ./templates/* resolve
copyDirRecursive(path.join(ROOT, 'public', 'templates'), path.join(DIST, 'templates'));

console.log('Built static GitHub Pages bundle in ./dist successfully.');
