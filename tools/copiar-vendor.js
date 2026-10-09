// Copia html5-qrcode (instalada con npm) a docs/vendor/ para servirla sin CDN.
'use strict';
const fs = require('fs');
const path = require('path');

const origen = path.join(__dirname, '..', 'node_modules', 'html5-qrcode');
const destino = path.join(__dirname, '..', 'docs', 'vendor');

const version = require(path.join(origen, 'package.json')).version;
if (version !== '2.3.8') {
  console.error(`Se esperaba html5-qrcode 2.3.8 y está instalada la ${version}.`);
  process.exit(1);
}

fs.mkdirSync(destino, { recursive: true });
fs.copyFileSync(path.join(origen, 'html5-qrcode.min.js'), path.join(destino, 'html5-qrcode.min.js'));
fs.copyFileSync(path.join(origen, 'LICENSE'), path.join(destino, 'html5-qrcode.LICENSE.txt'));
console.log(`html5-qrcode ${version} copiada a docs/vendor/`);
