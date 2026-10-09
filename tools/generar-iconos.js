/*
 * Genera los íconos PNG de la PWA sin dependencias (solo zlib de Node).
 * Diseño sobrio: un QR estilizado blanco sobre azul petróleo.
 *   icons/icon-192.png, icons/icon-512.png      -> esquinas redondeadas, fondo transparente
 *   icons/maskable-512.png                      -> fondo completo, glifo dentro de la zona segura
 *   icons/apple-touch-icon.png (180)            -> fondo completo (iOS redondea por su cuenta)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FONDO = [0x0f, 0x5e, 0x66];
const FRENTE = [0xff, 0xff, 0xff];
const DESTINO = path.join(__dirname, '..', 'docs', 'icons');

// Glifo en una grilla de 17x17 módulos: tres patrones de posición y algunos módulos de datos
const N = 17;
const modulos = new Set();
function agregarPatron(x0, y0) {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const borde = x === 0 || x === 6 || y === 0 || y === 6;
      const centro = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      if (borde || centro) modulos.add(`${x0 + x},${y0 + y}`);
    }
  }
}
agregarPatron(0, 0);
agregarPatron(10, 0);
agregarPatron(0, 10);
[
  [8, 1], [8, 3], [8, 5], [1, 8], [3, 8], [5, 8], [7, 8], [9, 8], [11, 8], [13, 8], [15, 8],
  [8, 10], [10, 10], [14, 10], [12, 11], [16, 11], [9, 12], [11, 13], [13, 13], [16, 13],
  [8, 14], [15, 14], [10, 15], [13, 15], [9, 16], [12, 16], [14, 16], [16, 16]
].forEach(([x, y]) => modulos.add(`${x},${y}`));

/** Devuelve la cobertura [0..1] del glifo/fondo en un punto continuo (u,v) del ícono. */
function muestrear(u, v, opciones) {
  // Fondo: cuadrado redondeado o completo
  let enFondo = true;
  if (opciones.redondeado) {
    const r = 0.22;
    const cx = Math.min(Math.max(u, r), 1 - r);
    const cy = Math.min(Math.max(v, r), 1 - r);
    enFondo = (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  }
  if (!enFondo) return null;
  const inicio = (1 - opciones.glifo) / 2;
  const gx = (u - inicio) / opciones.glifo;
  const gy = (v - inicio) / opciones.glifo;
  if (gx >= 0 && gx < 1 && gy >= 0 && gy < 1) {
    const mx = Math.floor(gx * N);
    const my = Math.floor(gy * N);
    if (modulos.has(`${mx},${my}`)) return FRENTE;
  }
  return FONDO;
}

function dibujar(tamano, opciones) {
  const SS = 4; // supermuestreo para bordes suaves
  const pixeles = Buffer.alloc(tamano * tamano * 4);
  for (let y = 0; y < tamano; y++) {
    for (let x = 0; x < tamano; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = muestrear((x + (sx + 0.5) / SS) / tamano, (y + (sy + 0.5) / SS) / tamano, opciones);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const i = (y * tamano + x) * 4;
      if (a > 0) {
        pixeles[i] = Math.round(r / a);
        pixeles[i + 1] = Math.round(g / a);
        pixeles[i + 2] = Math.round(b / a);
      }
      pixeles[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return codificarPng(tamano, tamano, pixeles);
}

// ---------- Codificador PNG mínimo (RGBA 8 bits) ----------
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloque(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const tipoYDatos = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tipoYDatos));
  return Buffer.concat([largo, tipoYDatos, crc]);
}

function codificarPng(ancho, alto, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;  // bits por canal
  ihdr[9] = 6;  // RGBA
  const filas = Buffer.alloc((ancho * 4 + 1) * alto);
  for (let y = 0; y < alto; y++) {
    filas[y * (ancho * 4 + 1)] = 0; // filtro "None"
    rgba.copy(filas, y * (ancho * 4 + 1) + 1, y * ancho * 4, (y + 1) * ancho * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', zlib.deflateSync(filas, { level: 9 })),
    bloque('IEND', Buffer.alloc(0))
  ]);
}

fs.mkdirSync(DESTINO, { recursive: true });
const salidas = [
  ['icon-192.png', 192, { redondeado: true, glifo: 0.58 }],
  ['icon-512.png', 512, { redondeado: true, glifo: 0.58 }],
  ['maskable-512.png', 512, { redondeado: false, glifo: 0.5 }],
  ['apple-touch-icon.png', 180, { redondeado: false, glifo: 0.6 }]
];
for (const [nombre, tamano, opciones] of salidas) {
  fs.writeFileSync(path.join(DESTINO, nombre), dibujar(tamano, opciones));
  console.log('Generado docs/icons/' + nombre);
}
