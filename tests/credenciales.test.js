// Pruebas del generador de credenciales.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generarClave, listaUsuarios, ALFABETO, LARGO } = require('../tools/generar-credenciales.js');

test('el alfabeto excluye caracteres que se confunden', () => {
  for (const c of '0O1lI') assert.ok(!ALFABETO.includes(c), c);
});

test('las contraseñas tienen 12 caracteres con mayúscula, minúscula y número', () => {
  const vistas = new Set();
  for (let i = 0; i < 500; i++) {
    const c = generarClave();
    assert.equal(c.length, LARGO);
    assert.match(c, /[A-Z]/);
    assert.match(c, /[a-z]/);
    assert.match(c, /[0-9]/);
    for (const ch of c) assert.ok(ALFABETO.includes(ch));
    vistas.add(c);
  }
  assert.equal(vistas.size, 500);
});

test('la lista tiene admin y User01..User30', () => {
  const lista = listaUsuarios();
  assert.equal(lista.length, 31);
  assert.deepEqual(lista[0], { usuario: 'admin', rol: 'ADMIN' });
  assert.deepEqual(lista[1], { usuario: 'User01', rol: 'USUARIO' });
  assert.deepEqual(lista[30], { usuario: 'User30', rol: 'USUARIO' });
});
