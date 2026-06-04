// Dependency-free icon copier (replaces gulp). Mirrors the standard n8n build:
// copy node/credential SVG+PNG icons into dist/ next to the compiled .js files.
const fs = require('fs');
const path = require('path');

function copyIcons(srcRoot, destRoot) {
  if (!fs.existsSync(srcRoot)) return;
  for (const entry of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    const srcPath = path.join(srcRoot, entry.name);
    const destPath = path.join(destRoot, entry.name);
    if (entry.isDirectory()) {
      copyIcons(srcPath, destPath);
    } else if (/\.(svg|png)$/i.test(entry.name)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      console.log(`[icons] ${srcPath} -> ${destPath}`);
    }
  }
}

copyIcons(path.resolve('nodes'), path.resolve('dist', 'nodes'));
copyIcons(path.resolve('credentials'), path.resolve('dist', 'credentials'));
