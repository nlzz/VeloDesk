import fs from 'fs';
import path from 'path';

const src = path.resolve('viewer', 'dist');
const dest = path.resolve('dist');

if (fs.existsSync(src)) {
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[VeloDesk Deploy] Copiado viewer/dist -> dist com sucesso.`);
} else {
  console.warn(`[VeloDesk Deploy] Aviso: ${src} não encontrado.`);
}
