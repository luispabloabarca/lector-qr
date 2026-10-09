/*
 * Lógica pura del Lector QR, sin acceso al DOM ni a la red.
 * Funciona en el navegador (queda disponible como window.Logica)
 * y en Node (module.exports), para poder probarla con node:test.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) {
    module.exports = fabrica();
  } else {
    raiz.Logica = fabrica();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_CAMPO = 100;
  var MAX_OBSERVACION = 500;

  /**
   * Valida la URL de la aplicación web de Apps Script.
   * Solo se acepta https://script.google.com/macros/s/<id>/exec
   * Devuelve { ok, url } con la URL normalizada (sin parámetros) o { ok:false }.
   */
  function validarUrlScript(texto) {
    if (typeof texto !== 'string') return { ok: false };
    var limpio = texto.trim();
    var url;
    try {
      url = new URL(limpio);
    } catch (e) {
      return { ok: false };
    }
    if (url.protocol !== 'https:') return { ok: false };
    if (url.hostname !== 'script.google.com') return { ok: false };
    if (url.username || url.password || url.port) return { ok: false };
    if (!/^\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/.test(url.pathname)) return { ok: false };
    return { ok: true, url: url.origin + url.pathname };
  }

  /**
   * Separa el contenido del QR en sus 3 campos: pedido;producto;pallet.
   * Ejemplo: "RENDIC: 20260922;719638;325".
   * Cada campo se recorta de espacios en los extremos y se conserva tal cual.
   */
  function parsearQr(texto) {
    if (typeof texto !== 'string') return { ok: false };
    var partes = texto.split(';').map(function (p) { return p.trim(); });
    if (partes.length !== 3) return { ok: false };
    return validarCampos(partes[0], partes[1], partes[2]);
  }

  /** Valida los 3 campos (sirve también para el ingreso manual). */
  function validarCampos(pedido, producto, pallet) {
    var campos = [pedido, producto, pallet].map(function (c) {
      return typeof c === 'string' ? c.trim() : '';
    });
    for (var i = 0; i < campos.length; i++) {
      if (campos[i] === '' || campos[i].length > MAX_CAMPO) return { ok: false };
    }
    return { ok: true, pedido: campos[0], producto: campos[1], pallet: campos[2] };
  }

  /** Normaliza la observación: texto recortado o vacío; null si es demasiado larga. */
  function normalizarObservacion(texto) {
    var obs = typeof texto === 'string' ? texto.trim() : '';
    return obs.length > MAX_OBSERVACION ? null : obs;
  }

  /**
   * Crea un filtro anti doble lectura: el mismo contenido se ignora
   * si se repite antes de `ventanaMs` milisegundos.
   */
  function crearAntiDobleLectura(ventanaMs) {
    var ventana = typeof ventanaMs === 'number' ? ventanaMs : 3000;
    var ultimoTexto = null;
    var ultimoMomento = 0;
    return function esRepetida(texto, ahora) {
      var t = typeof ahora === 'number' ? ahora : Date.now();
      if (texto === ultimoTexto && t - ultimoMomento < ventana) return true;
      ultimoTexto = texto;
      ultimoMomento = t;
      return false;
    };
  }

  /** Genera un UUID v4 con el generador criptográfico disponible. */
  function generarUuid() {
    var c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) {
      return (x + 0x100).toString(16).slice(1);
    }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' +
      h.slice(16, 20) + '-' + h.slice(20);
  }

  /** Clave para reconocer "la misma lectura" (mismos 3 campos). */
  function claveLectura(l) {
    return [l.pedido, l.producto, l.pallet].join('\u0001');
  }

  /**
   * Construye un CSV para Excel en español: separador ";", fin de línea CRLF
   * y BOM UTF-8 para que las tildes se vean bien.
   * Los valores que empiezan con = + - @ se anteponen con ' para que Excel
   * no los interprete como fórmulas.
   */
  function construirCsv(filas) {
    var lineas = filas.map(function (fila) {
      return fila.map(function (valor) {
        var v = valor === null || valor === undefined ? '' : String(valor);
        if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
        if (/[";\r\n]/.test(v) || /^\s|\s$/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
        return v;
      }).join(';');
    });
    return '﻿' + lineas.join('\r\n') + '\r\n';
  }

  return {
    MAX_CAMPO: MAX_CAMPO,
    MAX_OBSERVACION: MAX_OBSERVACION,
    validarUrlScript: validarUrlScript,
    parsearQr: parsearQr,
    validarCampos: validarCampos,
    normalizarObservacion: normalizarObservacion,
    crearAntiDobleLectura: crearAntiDobleLectura,
    generarUuid: generarUuid,
    claveLectura: claveLectura,
    construirCsv: construirCsv
  };
});
