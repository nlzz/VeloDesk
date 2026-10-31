import fs from 'fs';
import path from 'path';

const src = path.resolve('viewer', 'dist');
const dest = path.resolve('dist');

if (fs.existsSync(src)) {
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[VeloDesk Deploy] Copiado viewer/dist -> dist com sucesso.`);
} else {
  console.warn(`[VeloDesk Deploy] Aviso: ${src} não encontrado.`);
}
