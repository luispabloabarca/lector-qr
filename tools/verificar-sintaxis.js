// Ejecuta `node --check` sobre todos los JS del proyecto (y Code.gs) y reporta errores.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const IGNORAR = new Set(['node_modules', 'vendor', '.git', 'privado']);

function recorrer(dir, salida) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, salida);
    else if (/\.(js|gs)$/.test(e.name)) salida.push(p);
  }
  return salida;
}

let errores = 0;
for (const archivo of recorrer(RAIZ, [])) {
  let objetivo = archivo;
  // node --check no reconoce .gs: se revisa una copia temporal con extensión .js
  if (archivo.endsWith('.gs')) {
    objetivo = path.join(os.tmpdir(), 'lector-qr-' + path.basename(archivo) + '.js');
    fs.copyFileSync(archivo, objetivo);
  }
  try {
    execFileSync(process.execPath, ['--check', objetivo], { stdio: 'pipe' });
    console.log('OK   ' + path.relative(RAIZ, archivo));
  } catch (e) {
    errores++;
    console.log('FALLA ' + path.relative(RAIZ, archivo) + '\n' + e.stderr.toString());
  }
}
process.exit(errores ? 1 : 0);
