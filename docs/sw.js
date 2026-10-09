/*
 * Service worker del Lector QR.
 * Cachea la app y la librería para que abra rápido y sea instalable.
 * NUNCA intercepta solicitudes POST ni de otros orígenes (las llamadas al
 * Apps Script siempre van directo a la red).
 *
 * IMPORTANTE: al cambiar cualquier archivo de docs/, sube VERSION para que
 * los celulares descarguen la nueva versión.
 */
'use strict';

var VERSION = 'lector-qr-v1';
var ARCHIVOS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './lib/logica.js',
  './vendor/html5-qrcode.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // cache: 'reload' evita copiar respuestas viejas del caché HTTP
      return cache.addAll(ARCHIVOS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys().then(function (claves) {
      return Promise.all(claves.filter(function (c) {
        return c.indexOf('lector-qr-') === 0 && c !== VERSION;
      }).map(function (c) { return caches.delete(c); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (evento) {
  var req = evento.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  evento.respondWith(
    caches.open(VERSION).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (guardada) {
        return guardada || fetch(req);
      });
    })
  );
});
