import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, 'public');
const dst = path.join(__dirname, 'public');

function copyDir(srcDir, dstDir) {
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const dirent of entries) {
    const s = path.join(srcDir, dirent.name);
    const d = path.join(dstDir, dirent.name);
    if (dirent.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

copyDir(src, dst);
console.log('Copied public folder successfully');