// Pruebas de la lógica pura compartida (docs/lib/logica.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../docs/lib/logica.js');

const URL_OK = 'https://script.google.com/macros/s/AKfycbx1234567890abcdef_-XYZ/exec';

test('validarUrlScript acepta la URL de una implementación y la normaliza', () => {
  assert.deepEqual(L.validarUrlScript('  ' + URL_OK + '  '), { ok: true, url: URL_OK });
  assert.deepEqual(L.validarUrlScript(URL_OK + '?x=1#a'), { ok: true, url: URL_OK });
});

test('validarUrlScript rechaza URLs que no son de Apps Script', () => {
  const malas = [
    '', 'hola', null, 123,
    URL_OK.replace('https', 'http'),
    URL_OK.replace('/exec', '/dev'),
    URL_OK.replace('script.google.com', 'script.google.com.evil.cl'),
    URL_OK.replace('script.google.com', 'evil.cl'),
    'https://script.googleusercontent.com/macros/echo?user_content_key=abc',
    'https://usuario:clave@script.google.com/macros/s/AKfycbx1234567890/exec',
    'https://script.google.com:444/macros/s/AKfycbx1234567890/exec',
    'https://script.google.com/macros/s/corto/exec',
    'javascript:alert(1)'
  ];
  for (const u of malas) assert.equal(L.validarUrlScript(u).ok, false, String(u));
});

test('parsearQr separa pedido, producto y pallet del ejemplo real', () => {
  assert.deepEqual(L.parsearQr('RENDIC: 20260922;719638;325'),
    { ok: true, pedido: 'RENDIC: 20260922', producto: '719638', pallet: '325' });
});

test('parsearQr recorta espacios y conserva ceros a la izquierda', () => {
  assert.deepEqual(L.parsearQr('  P-01 ; 000123 ;0007\n'),
    { ok: true, pedido: 'P-01', producto: '000123', pallet: '0007' });
});

test('parsearQr rechaza QR sin exactamente 3 campos no vacíos', () => {
  for (const t of ['', 'solo-uno', 'a;b', 'a;b;c;d', 'a;;c', ' ;b;c', 'a;b; ', null, undefined, 42]) {
    assert.equal(L.parsearQr(t).ok, false, String(t));
  }
  assert.equal(L.parsearQr('a;b;' + 'x'.repeat(101)).ok, false);
  assert.equal(L.parsearQr('a;b;' + 'x'.repeat(100)).ok, true);
});

test('validarCampos sirve para el ingreso manual', () => {
  assert.deepEqual(L.validarCampos(' A ', 'B', 'C'), { ok: true, pedido: 'A', producto: 'B', pallet: 'C' });
  assert.equal(L.validarCampos('A', '', 'C').ok, false);
  assert.equal(L.validarCampos('A', undefined, 'C').ok, false);
});

test('normalizarObservacion recorta y limita el largo', () => {
  assert.equal(L.normalizarObservacion('  hola '), 'hola');
  assert.equal(L.normalizarObservacion(undefined), '');
  assert.equal(L.normalizarObservacion('x'.repeat(500)).length, 500);
  assert.equal(L.normalizarObservacion('x'.repeat(501)), null);
});

test('anti doble lectura ignora el mismo contenido durante 3 segundos', () => {
  const esRepetida = L.crearAntiDobleLectura(3000);
  assert.equal(esRepetida('A', 1000), false);
  assert.equal(esRepetida('A', 2000), true);
  assert.equal(esRepetida('A', 3999), true);
  assert.equal(esRepetida('B', 4000), false);
  assert.equal(esRepetida('A', 4100), false, 'otro código en medio reinicia');
  assert.equal(esRepetida('A', 7100), false, 'pasados 3 s se acepta de nuevo');
});

test('generarUuid produce UUID v4 distintos', () => {
  const vistos = new Set();
  for (let i = 0; i < 200; i++) {
    const u = L.generarUuid();
    assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    vistos.add(u);
  }
  assert.equal(vistos.size, 200);
});

test('claveLectura identifica los mismos 3 campos', () => {
  const a = { pedido: 'P', producto: '1', pallet: '2' };
  assert.equal(L.claveLectura(a), L.claveLectura({ ...a }));
  assert.notEqual(L.claveLectura(a), L.claveLectura({ ...a, pallet: '3' }));
});

test('construirCsv: BOM, separador ;, comillas y neutralización de fórmulas', () => {
  const csv = L.construirCsv([
    ['Correlativo', 'N° pedido', 'Observación'],
    [1, 'RENDIC: 20260922', 'con; punto y coma'],
    [2, '=HYPERLINK("x")', 'dijo "hola"'],
    [3, '-5', 'línea\nnueva']
  ]);
  assert.ok(csv.startsWith('﻿'));
  const lineas = csv.slice(1).split('\r\n');
  assert.equal(lineas[0], 'Correlativo;N° pedido;Observación');
  assert.equal(lineas[1], '1;RENDIC: 20260922;"con; punto y coma"');
  assert.equal(lineas[2], `2;"'=HYPERLINK(""x"")";"dijo ""hola"""`);
  assert.equal(lineas[3], "3;'-5;\"línea\nnueva\"");
});
