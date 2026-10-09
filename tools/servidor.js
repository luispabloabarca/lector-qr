// Servidor estático mínimo para probar docs/ en local: node tools/servidor.js [puerto]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', 'docs');
const PUERTO = Number(process.argv[2]) || 8080;
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
  let ruta = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (ruta.endsWith('/')) ruta += 'index.html';
  const archivo = path.normalize(path.join(RAIZ, ruta));
  // Evita salir de docs/ con rutas tipo ../
  if (!archivo.startsWith(RAIZ)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(archivo, (err, datos) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(datos);
  });
}).listen(PUERTO, () => console.log(`Sirviendo docs/ en http://localhost:${PUERTO}/`));
