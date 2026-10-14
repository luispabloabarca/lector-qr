// Pruebas del Code.gs real, ejecutado en Node con servicios de Apps Script simulados.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { crearEntorno } = require('./mocks-apps-script');

const CLAVE_ADMIN = 'AdminClave234';
const CLAVE_U1 = 'Ab3defGh5jkm';
const CLAVE_U2 = 'Zx9wvuTs8rqp';

function entornoConUsuarios() {
  const e = crearEntorno();
  const msg = e.gs.procesarCredenciales([
    '# comentario',
    `admin;${CLAVE_ADMIN};ADMIN`,
    `User01;${CLAVE_U1};USUARIO`,
    `User02;${CLAVE_U2};USUARIO`
  ].join('\n'));
  assert.match(msg, /Creados: 3/);
  return e;
}

function login(e, usuario, clave) {
  return e.post({ action: 'login', usuario, clave });
}

function lectura(e, token, extra) {
  return e.post(Object.assign({
    action: 'lectura', token, id: crypto.randomUUID(),
    pedido: 'RENDIC: 20260922', producto: '719638', pallet: '325', observacion: ''
  }, extra));
}

// ---------- Hash ----------

test('el hash coincide con SHA-256 de pepper + sal + usuario + ":" + contraseña', () => {
  const e = crearEntorno();
  const esperado = crypto.createHash('sha256').update('pepsaluser01:Clave ñ', 'utf8').digest('hex');
  assert.equal(e.gs.calcularHash_('pep', 'sal', 'user01', 'Clave ñ'), esperado);
});

test('bytesAHex_ convierte bytes con signo correctamente', () => {
  const e = crearEntorno();
  assert.equal(e.gs.bytesAHex_([0, 15, 127, -128, -1]), '000f7f80ff');
});

// ---------- Carga de usuarios ----------

test('procesarCredenciales guarda sal y hash, nunca la contraseña', () => {
  const e = entornoConUsuarios();
  const filas = e.hojas.Usuarios.datos.slice(1);
  assert.equal(filas.length, 3);
  for (const f of filas) {
    assert.equal(f.length, 5);
    assert.match(f[1], /^[0-9a-f]{32}$/);
    assert.match(f[2], /^[0-9a-f]{64}$/);
    assert.ok(!f.includes(CLAVE_ADMIN) && !f.includes(CLAVE_U1));
  }
  assert.deepEqual(filas.map((f) => [f[0], f[3], f[4]]),
    [['admin', 'SI', 'ADMIN'], ['User01', 'SI', 'USUARIO'], ['User02', 'SI', 'USUARIO']]);
  // Sales distintas por usuario
  assert.equal(new Set(filas.map((f) => f[1])).size, 3);
});

test('procesarCredenciales informa líneas inválidas y actualiza existentes', () => {
  const e = entornoConUsuarios();
  const msg = e.gs.procesarCredenciales('user01;NuevaClave99;USUARIO\ncorta;abc\nmal nombre;Clave12345\nx;Clave12345;JEFE');
  assert.match(msg, /Creados: 0/);
  assert.match(msg, /Actualizados: 1/);
  assert.match(msg, /2, 3, 4/);
  assert.equal(e.hojas.Usuarios.datos.length, 4);
  assert.equal(login(e, 'User01', CLAVE_U1).error, 'CREDENCIALES');
  assert.equal(login(e, 'User01', 'NuevaClave99').ok, true);
});

// ---------- Login ----------

test('login correcto devuelve token, usuario y rol (sin distinguir mayúsculas)', () => {
  const e = entornoConUsuarios();
  const r = login(e, '  user01 ', CLAVE_U1);
  assert.equal(r.ok, true);
  assert.equal(r.usuario, 'User01');
  assert.equal(r.rol, 'USUARIO');
  assert.match(r.token, /^[0-9a-f]{64}$/);
  assert.equal(login(e, 'ADMIN', CLAVE_ADMIN).rol, 'ADMIN');
});

test('el token no se guarda en claro en las propiedades', () => {
  const e = entornoConUsuarios();
  const { token } = login(e, 'User01', CLAVE_U1);
  for (const [k, v] of e.props) {
    assert.ok(!k.includes(token) && !v.includes(token));
  }
});

test('usuario inexistente y contraseña incorrecta dan la misma respuesta', () => {
  const e = entornoConUsuarios();
  assert.deepEqual(login(e, 'User01', 'incorrecta'), { ok: false, error: 'CREDENCIALES' });
  assert.deepEqual(login(e, 'NoExiste', 'loquesea'), { ok: false, error: 'CREDENCIALES' });
});

test('usuario inactivo: INACTIVO solo con contraseña correcta', () => {
  const e = entornoConUsuarios();
  e.hojas.Usuarios.escribir(3, 4, 'NO');
  assert.equal(login(e, 'User01', CLAVE_U1).error, 'INACTIVO');
  assert.equal(login(e, 'User01', 'incorrecta').error, 'CREDENCIALES');
});

test('5 fallos bloquean al usuario 10 minutos, incluso con la contraseña correcta', () => {
  const e = entornoConUsuarios();
  for (let i = 0; i < 5; i++) assert.equal(login(e, 'User01', 'mala' + i).error, 'CREDENCIALES');
  assert.equal(login(e, 'User01', CLAVE_U1).error, 'BLOQUEADO');
  // Otro usuario no se ve afectado
  assert.equal(login(e, 'User02', CLAVE_U2).ok, true);
  // También se bloquean nombres inexistentes
  for (let i = 0; i < 5; i++) login(e, 'fantasma', 'x');
  assert.equal(login(e, 'fantasma', 'x').error, 'BLOQUEADO');
  // Pasados 10 minutos se libera
  e.reloj.desfaseMs = 601 * 1000;
  assert.equal(login(e, 'User01', CLAVE_U1).ok, true);
});

test('un login correcto reinicia el contador de fallos', () => {
  const e = entornoConUsuarios();
  for (let i = 0; i < 4; i++) login(e, 'User01', 'mala');
  assert.equal(login(e, 'User01', CLAVE_U1).ok, true);
  for (let i = 0; i < 4; i++) login(e, 'User01', 'mala');
  assert.equal(login(e, 'User01', CLAVE_U1).ok, true);
});

// ---------- Sesión ----------

test('token inválido, vencido, usuario desactivado o logout producen SESION', () => {
  const e = entornoConUsuarios();
  assert.equal(lectura(e, 'x'.repeat(64)).error, 'SESION');
  assert.equal(lectura(e, undefined).error, 'SESION');

  const t1 = login(e, 'User01', CLAVE_U1).token;
  const claveSesion = [...e.props.keys()].find((k) => k.startsWith('sesion_'));
  const s = JSON.parse(e.props.get(claveSesion));
  e.props.set(claveSesion, JSON.stringify({ u: s.u, e: Date.now() - 1 }));
  assert.equal(lectura(e, t1).error, 'SESION');
  assert.ok(!e.props.has(claveSesion), 'la sesión vencida se elimina');

  const t2 = login(e, 'User01', CLAVE_U1).token;
  assert.equal(lectura(e, t2).ok, true);
  e.hojas.Usuarios.escribir(3, 4, 'NO');
  assert.equal(lectura(e, t2, { pallet: '999' }).error, 'SESION');
  e.hojas.Usuarios.escribir(3, 4, 'SI');

  const t3 = login(e, 'User02', CLAVE_U2).token;
  assert.deepEqual(e.post({ action: 'logout', token: t3 }), { ok: true });
  assert.equal(lectura(e, t3, { pallet: '998' }).error, 'SESION');
});

test('recargar la contraseña de un usuario cierra sus sesiones', () => {
  const e = entornoConUsuarios();
  const t = login(e, 'User01', CLAVE_U1).token;
  e.gs.procesarCredenciales('User01;OtraClave777;USUARIO');
  assert.equal(lectura(e, t).error, 'SESION');
});

// ---------- Lecturas ----------

test('lectura correcta: correlativo, usuario del servidor y fecha', () => {
  const e = entornoConUsuarios();
  const { token } = login(e, 'User01', CLAVE_U1);
  const r1 = lectura(e, token, { usuario: 'admin' }); // el usuario del cliente se ignora
  assert.equal(r1.ok, true);
  assert.equal(r1.correlativo, 1);
  assert.equal(r1.usuario, 'User01');
  assert.match(r1.fecha, /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
  const r2 = lectura(e, token, { pallet: '326', observacion: '  esquina rota  ' });
  assert.equal(r2.correlativo, 2);
  const fila = e.hojas.Lecturas.datos[2];
  assert.deepEqual(fila.slice(0, 5), [2, 'RENDIC: 20260922', '719638', '326', 'User01']);
  assert.ok(fila[5] instanceof Date);
  assert.equal(fila[6], 'esquina rota');
  assert.match(fila[7], /^[0-9a-f-]{36}$/);
});

test('un ID repetido responde ok sin duplicar la fila', () => {
  const e = entornoConUsuarios();
  const { token } = login(e, 'User01', CLAVE_U1);
  const id = crypto.randomUUID();
  const r1 = lectura(e, token, { id });
  const r2 = lectura(e, token, { id });
  assert.equal(r2.ok, true);
  assert.equal(r2.repetido, true);
  assert.equal(r2.correlativo, r1.correlativo);
  assert.equal(e.hojas.Lecturas.datos.length, 2);
});

test('reintento tras timeout con el mismo ID: ok aunque la columna ID esté oculta (caché)', () => {
  const e = entornoConUsuarios();
  e.hojas.Lecturas.hideColumns(8);
  const { token } = login(e, 'User01', CLAVE_U1);
  const id = crypto.randomUUID();
  const r1 = lectura(e, token, { id });
  const r2 = lectura(e, token, { id });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.repetido, true);
  assert.equal(r2.correlativo, r1.correlativo);
  assert.equal(r2.fecha, r1.fecha);
  assert.equal(e.hojas.Lecturas.datos.length, 2);
});

test('un ID repetido se reconoce en la hoja aunque ya no esté en caché', () => {
  const e = entornoConUsuarios();
  const { token } = login(e, 'User01', CLAVE_U1);
  const id = crypto.randomUUID();
  lectura(e, token, { id });
  e.cache.clear();
  const r = lectura(e, token, { id });
  assert.equal(r.repetido, true);
  assert.equal(e.hojas.Lecturas.datos.length, 2);
});

test('misma lectura: DUPLICADO, luego exige observación y agrega fila nueva', () => {
  const e = entornoConUsuarios();
  const t1 = login(e, 'User01', CLAVE_U1).token;
  const t2 = login(e, 'User02', CLAVE_U2).token;
  lectura(e, t1);
  const id = crypto.randomUUID();
  const dup = lectura(e, t2, { id });
  assert.equal(dup.ok, false);
  assert.equal(dup.error, 'DUPLICADO');
  assert.equal(dup.previo.usuario, 'User01');
  assert.equal(dup.previo.correlativo, 1);
  assert.equal(e.hojas.Lecturas.datos.length, 2, 'no escribe sin confirmación');

  assert.equal(lectura(e, t2, { id, confirmarDuplicado: true, observacion: '  ' }).error, 'OBSERVACION_REQUERIDA');
  const ok = lectura(e, t2, { id, confirmarDuplicado: true, observacion: 'Pallet re-etiquetado' });
  assert.equal(ok.ok, true);
  assert.equal(ok.correlativo, 2);
  assert.equal(e.hojas.Lecturas.datos.length, 3);
  // La fila original no se modifica
  assert.equal(e.hojas.Lecturas.datos[1][4], 'User01');
});

test('mismo pallet con otro pedido o producto no es duplicado', () => {
  const e = entornoConUsuarios();
  const { token } = login(e, 'User01', CLAVE_U1);
  lectura(e, token);
  assert.equal(lectura(e, token, { pedido: 'RENDIC: 20260923' }).ok, true);
  assert.equal(lectura(e, token, { producto: '719639' }).ok, true);
});

test('valores que empiezan con = + - @ se guardan neutralizados y se detectan como duplicado', () => {
  const e = entornoConUsuarios();
  const { token } = login(e, 'User01', CLAVE_U1);
  assert.equal(lectura(e, token, { pedido: '=IMPORTXML("x")', observacion: '+1' }).ok, true);
  const fila = e.hojas.Lecturas.datos[1];
  assert.equal(fila[1], "'=IMPORTXML(\"x\")");
  assert.equal(fila[6], "'+1");
  assert.equal(lectura(e, token, { pedido: '=IMPORTXML("x")' }).error, 'DUPLICADO');
});

test('validación de entrada', () => {
  const e = entornoConUsuarios();
  const { token } = login(e, 'User01', CLAVE_U1);
  assert.equal(e.post('{esto no es json').error, 'ENTRADA_INVALIDA');
  assert.equal(e.post('[1,2]').error, 'ENTRADA_INVALIDA');
  assert.equal(e.post('"texto"').error, 'ENTRADA_INVALIDA');
  assert.equal(JSON.parse(e.gs.doPost(undefined).getContent()).error, 'ENTRADA_INVALIDA');
  assert.equal(e.post({ action: 'borrarTodo' }).error, 'ACCION_DESCONOCIDA');
  assert.equal(e.post({ action: 'login', usuario: 123, clave: 'x' }).error, 'ENTRADA_INVALIDA');
  assert.equal(e.post({ action: 'login', usuario: 'a'.repeat(51), clave: 'x' }).error, 'ENTRADA_INVALIDA');
  assert.equal(lectura(e, token, { id: '' }).error, 'ENTRADA_INVALIDA');
  assert.equal(lectura(e, token, { id: 'x'.repeat(65) }).error, 'ENTRADA_INVALIDA');
  assert.equal(lectura(e, token, { id: 'con espacios' }).error, 'ENTRADA_INVALIDA');
  assert.equal(lectura(e, token, { pallet: '' }).error, 'QR_INVALIDO');
  assert.equal(lectura(e, token, { pedido: 42 }).error, 'QR_INVALIDO');
  assert.equal(lectura(e, token, { producto: 'x'.repeat(101) }).error, 'QR_INVALIDO');
  assert.equal(lectura(e, token, { observacion: 'x'.repeat(501) }).error, 'ENTRADA_INVALIDA');
  assert.equal(lectura(e, token, { observacion: 5 }).error, 'ENTRADA_INVALIDA');
  assert.equal(lectura(e, token, { confirmarDuplicado: 'si' }).error, 'ENTRADA_INVALIDA');
  assert.equal(e.hojas.Lecturas.datos.length, 1, 'ninguna entrada inválida escribe filas');
});

test('un error interno responde INTERNO sin registrar datos sensibles', () => {
  const e = entornoConUsuarios();
  e.props.delete('PEPPER');
  const r = login(e, 'User01', CLAVE_U1);
  assert.deepEqual(r, { ok: false, error: 'INTERNO' });
  assert.ok(e.registros.length > 0);
  for (const linea of e.registros) assert.ok(!linea.includes(CLAVE_U1));
});

test('nunca se registran contraseñas ni tokens en los logs', () => {
  const e = entornoConUsuarios();
  const { token } = login(e, 'User01', CLAVE_U1);
  login(e, 'User01', 'mala');
  lectura(e, token);
  e.post('{roto' + CLAVE_U1);
  for (const linea of e.registros) {
    assert.ok(!linea.includes(CLAVE_U1) && !linea.includes(token));
  }
});

// ---------- Admin ----------

test('resumen y exportar: solo ADMIN', () => {
  const e = entornoConUsuarios();
  const tu = login(e, 'User01', CLAVE_U1).token;
  const tu2 = login(e, 'User02', CLAVE_U2).token;
  const ta = login(e, 'admin', CLAVE_ADMIN).token;
  lectura(e, tu, { pallet: '1' });
  lectura(e, tu, { pallet: '2' });
  lectura(e, tu2, { pallet: '3', observacion: 'nota; con "comillas"' });
  // Una lectura de otro día no cuenta en el resumen de hoy
  e.hojas.Lecturas.escribir(5, 1, 4);
  e.hojas.Lecturas.escribir(5, 5, 'User02');
  e.hojas.Lecturas.escribir(5, 6, new Date(Date.now() - 3 * 24 * 3600 * 1000));

  assert.equal(e.post({ action: 'resumen', token: tu }).error, 'NO_AUTORIZADO');
  assert.equal(e.post({ action: 'exportar', token: tu }).error, 'NO_AUTORIZADO');
  assert.equal(e.post({ action: 'resumen', token: 'malo'.repeat(10) }).error, 'SESION');

  const res = e.post({ action: 'resumen', token: ta });
  assert.equal(res.ok, true);
  assert.equal(res.total, 3);
  assert.deepEqual(res.porUsuario, [{ usuario: 'User01', cantidad: 2 }, { usuario: 'User02', cantidad: 1 }]);

  const exp = e.post({ action: 'exportar', token: ta });
  assert.equal(exp.ok, true);
  assert.equal(exp.filas.length, 5);
  assert.deepEqual(exp.filas[0], ['Correlativo', 'N° pedido', 'Código producto', 'N° pallet', 'Usuario', 'Fecha y hora', 'Observación']);
  assert.equal(exp.filas[3][6], 'nota; con "comillas"');
  assert.ok(exp.filas.every((f) => f.length === 7), 'la columna ID no se exporta');
});

test('doGet responde que el servicio está activo', () => {
  const e = crearEntorno();
  assert.deepEqual(JSON.parse(e.gs.doGet().getContent()), { ok: true, servicio: 'Lector QR' });
});
