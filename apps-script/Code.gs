/**
 * Lector QR - Backend en Google Apps Script.
 *
 * Se publica como aplicación web (Ejecutar como: Yo; Acceso: Cualquier persona).
 * Recibe solicitudes POST con JSON (Content-Type text/plain) y responde JSON:
 *   { ok: true, ...datos }  o  { ok: false, error: "CODIGO" }
 *
 * Acciones: login, logout, lectura, resumen (admin), exportar (admin).
 * Ningún secreto va escrito en este archivo: el pepper y el ID de la hoja se
 * guardan en las propiedades del script durante la "Configuración inicial".
 */

var ZONA = 'America/Santiago';
var HOJA_USUARIOS = 'Usuarios';
var HOJA_LECTURAS = 'Lecturas';
var ENCABEZADOS_USUARIOS = ['usuario', 'sal', 'hash', 'activo', 'rol'];
var ENCABEZADOS_LECTURAS = ['Correlativo', 'N° pedido', 'Código producto', 'N° pallet',
  'Usuario', 'Fecha y hora', 'Observación', 'ID'];
var FORMATO_FECHA = 'dd-MM-yyyy HH:mm:ss';

// Columnas de la hoja "Lecturas" (base 1)
var COL_CORRELATIVO = 1, COL_PEDIDO = 2, COL_PRODUCTO = 3, COL_PALLET = 4,
  COL_USUARIO = 5, COL_FECHA = 6, COL_OBSERVACION = 7, COL_ID = 8;
var NUM_COLUMNAS = 8;

// Límites de entrada
var MAX_CAMPO = 100;
var MAX_OBSERVACION = 500;
var MAX_USUARIO = 50;
var MAX_CLAVE = 200;
var MIN_CLAVE_NUEVA = 8;

// Sesiones y bloqueo por intentos
var DIAS_SESION = 30;
var MAX_FALLOS = 5;
var SEGUNDOS_BLOQUEO = 600; // 10 minutos
var PREFIJO_SESION = 'sesion_';

// IDs de lecturas recientes en caché (máximo que permite CacheService: 6 horas)
var PREFIJO_ID = 'id_';
var SEGUNDOS_CACHE_ID = 21600;

// ======================================================================
// Punto de entrada web
// ======================================================================

function doPost(e) {
  var respuesta;
  try {
    var datos = null;
    try {
      datos = JSON.parse(e && e.postData ? e.postData.contents : '');
    } catch (errJson) {
      datos = null;
    }
    respuesta = manejarSolicitud_(datos);
  } catch (err) {
    // Solo el mensaje del error: nunca el cuerpo de la solicitud (podría traer contraseñas)
    console.error('Error interno: ' + (err && err.message ? err.message : err));
    respuesta = { ok: false, error: 'INTERNO' };
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Permite comprobar en el navegador que la URL de la implementación responde. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, servicio: 'Lector QR' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function manejarSolicitud_(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return { ok: false, error: 'ENTRADA_INVALIDA' };
  }
  switch (datos.action) {
    case 'login': return accionLogin_(datos);
    case 'logout': return accionLogout_(datos);
    case 'lectura': return accionLectura_(datos);
    case 'resumen': return accionResumen_(datos);
    case 'exportar': return accionExportar_(datos);
    default: return { ok: false, error: 'ACCION_DESCONOCIDA' };
  }
}

// ======================================================================
// Acciones
// ======================================================================

function accionLogin_(datos) {
  if (!esTexto_(datos.usuario, 1, MAX_USUARIO) || !esTexto_(datos.clave, 1, MAX_CLAVE)) {
    return { ok: false, error: 'ENTRADA_INVALIDA' };
  }
  var nombre = normalizarUsuario_(datos.usuario);
  if (estaBloqueado_(nombre)) return { ok: false, error: 'BLOQUEADO' };

  var usuario = buscarUsuario_(nombre);
  var pepper = obtenerPepper_();
  var hashOk = usuario !== null &&
    compararSeguro_(calcularHash_(pepper, usuario.sal, nombre, datos.clave), usuario.hash);

  // Usuario inexistente o contraseña incorrecta: misma respuesta genérica
  if (!hashOk) {
    registrarFallo_(nombre);
    return { ok: false, error: 'CREDENCIALES' };
  }
  limpiarFallos_(nombre);
  // Solo se informa "inactivo" a quien demostró conocer la contraseña
  if (usuario.activo !== 'SI') return { ok: false, error: 'INACTIVO' };

  limpiarSesionesVencidas_();
  var token = generarToken_();
  var expira = Date.now() + DIAS_SESION * 24 * 3600 * 1000;
  PropertiesService.getScriptProperties().setProperty(
    PREFIJO_SESION + sha256Hex_(token),
    JSON.stringify({ u: nombre, e: expira })
  );
  return { ok: true, token: token, usuario: usuario.usuario, rol: usuario.rol, expira: expira };
}

function accionLogout_(datos) {
  if (esTexto_(datos.token, 20, 200)) {
    PropertiesService.getScriptProperties().deleteProperty(PREFIJO_SESION + sha256Hex_(datos.token));
  }
  return { ok: true };
}

function accionLectura_(datos) {
  if (!esTexto_(datos.id, 1, 64) || !/^[A-Za-z0-9-]+$/.test(datos.id)) {
    return { ok: false, error: 'ENTRADA_INVALIDA' };
  }
  var pedido = recortar_(datos.pedido);
  var producto = recortar_(datos.producto);
  var pallet = recortar_(datos.pallet);
  if (!pedido || !producto || !pallet ||
      pedido.length > MAX_CAMPO || producto.length > MAX_CAMPO || pallet.length > MAX_CAMPO) {
    return { ok: false, error: 'QR_INVALIDO' };
  }
  if (datos.observacion !== undefined && datos.observacion !== null && typeof datos.observacion !== 'string') {
    return { ok: false, error: 'ENTRADA_INVALIDA' };
  }
  var observacion = recortar_(datos.observacion);
  if (observacion.length > MAX_OBSERVACION) return { ok: false, error: 'ENTRADA_INVALIDA' };
  if (datos.confirmarDuplicado !== undefined && typeof datos.confirmarDuplicado !== 'boolean') {
    return { ok: false, error: 'ENTRADA_INVALIDA' };
  }
  var confirmar = datos.confirmarDuplicado === true;

  var sesion = validarSesion_(datos.token);
  if (!sesion) return { ok: false, error: 'SESION' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'OCUPADO' };
  try {
    var hoja = obtenerHoja_(HOJA_LECTURAS);
    var ultima = hoja.getLastRow();
    var cache = CacheService.getScriptCache();

    // (a) Mismo ID ya registrado (reintento): ok sin duplicar la fila.
    // Primero en caché (cubre los reintentos tras un timeout) y luego en la hoja.
    var enCache = cache.get(PREFIJO_ID + datos.id);
    if (enCache) {
      var guardada = JSON.parse(enCache);
      return { ok: true, repetido: true, correlativo: guardada.c, usuario: guardada.u, fecha: guardada.f };
    }
    if (ultima > 1) {
      var celdaId = hoja.getRange(2, COL_ID, ultima - 1, 1)
        .createTextFinder(datos.id).matchEntireCell(true).matchCase(true).findNext();
      if (celdaId) {
        var filaExistente = hoja.getRange(celdaId.getRow(), 1, 1, NUM_COLUMNAS).getValues()[0];
        return {
          ok: true,
          repetido: true,
          correlativo: filaExistente[COL_CORRELATIVO - 1],
          usuario: filaExistente[COL_USUARIO - 1],
          fecha: formatearFecha_(filaExistente[COL_FECHA - 1])
        };
      }
    }

    // (b) Misma lectura (mismos 3 campos) ya registrada antes
    var previo = buscarDuplicado_(hoja, ultima, pedido, producto, pallet);
    if (previo && !confirmar) {
      return { ok: false, error: 'DUPLICADO', previo: previo };
    }
    // (c) Duplicado confirmado: la observación es obligatoria
    if (previo && !observacion) return { ok: false, error: 'OBSERVACION_REQUERIDA' };

    var correlativo = 1;
    if (ultima > 1) {
      var anterior = Number(hoja.getRange(ultima, COL_CORRELATIVO).getValue());
      correlativo = isNaN(anterior) ? ultima : anterior + 1;
    }
    var ahora = new Date();
    hoja.getRange(ultima + 1, 1, 1, NUM_COLUMNAS).setValues([[
      correlativo,
      neutralizar_(pedido),
      neutralizar_(producto),
      neutralizar_(pallet),
      sesion.usuario,
      ahora,
      neutralizar_(observacion),
      datos.id
    ]]);
    SpreadsheetApp.flush();
    var fecha = formatearFecha_(ahora);
    cache.put(PREFIJO_ID + datos.id, JSON.stringify({ c: correlativo, u: sesion.usuario, f: fecha }), SEGUNDOS_CACHE_ID);
    return { ok: true, correlativo: correlativo, usuario: sesion.usuario, fecha: fecha };
  } finally {
    lock.releaseLock();
  }
}

function accionResumen_(datos) {
  var sesion = validarSesion_(datos.token);
  if (!sesion) return { ok: false, error: 'SESION' };
  if (sesion.rol !== 'ADMIN') return { ok: false, error: 'NO_AUTORIZADO' };

  var hoja = obtenerHoja_(HOJA_LECTURAS);
  var ultima = hoja.getLastRow();
  var hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  var conteo = {};
  var total = 0;
  if (ultima > 1) {
    // Solo se leen las columnas Usuario y Fecha
    var valores = hoja.getRange(2, COL_USUARIO, ultima - 1, 2).getValues();
    for (var i = 0; i < valores.length; i++) {
      var fecha = valores[i][1];
      if (fecha instanceof Date && Utilities.formatDate(fecha, ZONA, 'yyyy-MM-dd') === hoy) {
        var u = String(valores[i][0]);
        conteo[u] = (conteo[u] || 0) + 1;
        total++;
      }
    }
  }
  var porUsuario = Object.keys(conteo).sort().map(function (u) {
    return { usuario: u, cantidad: conteo[u] };
  });
  return { ok: true, fecha: Utilities.formatDate(new Date(), ZONA, 'dd-MM-yyyy'), total: total, porUsuario: porUsuario };
}

function accionExportar_(datos) {
  var sesion = validarSesion_(datos.token);
  if (!sesion) return { ok: false, error: 'SESION' };
  if (sesion.rol !== 'ADMIN') return { ok: false, error: 'NO_AUTORIZADO' };

  var hoja = obtenerHoja_(HOJA_LECTURAS);
  var ultima = Math.max(hoja.getLastRow(), 1);
  // Valores tal como se ven (fechas ya formateadas), sin la columna ID
  var filas = hoja.getRange(1, 1, ultima, COL_OBSERVACION).getDisplayValues();
  return { ok: true, filas: filas };
}

// ======================================================================
// Usuarios, contraseñas y sesiones
// ======================================================================

function normalizarUsuario_(nombre) {
  return String(nombre).trim().toLowerCase();
}

/** Busca un usuario (sin distinguir mayúsculas). Devuelve null si no existe. */
function buscarUsuario_(nombre) {
  var hoja = obtenerHoja_(HOJA_USUARIOS);
  var ultima = hoja.getLastRow();
  if (ultima < 2) return null;
  var valores = hoja.getRange(2, 1, ultima - 1, 5).getValues();
  for (var i = 0; i < valores.length; i++) {
    if (normalizarUsuario_(valores[i][0]) === nombre) {
      return {
        fila: i + 2,
        usuario: String(valores[i][0]),
        sal: String(valores[i][1]),
        hash: String(valores[i][2]),
        activo: String(valores[i][3]).trim().toUpperCase(),
        rol: String(valores[i][4]).trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USUARIO'
      };
    }
  }
  return null;
}

/** Hash = SHA-256 hex de (pepper + sal + usuario + ":" + contraseña). */
function calcularHash_(pepper, sal, usuarioNormalizado, clave) {
  return sha256Hex_(pepper + sal + usuarioNormalizado + ':' + clave);
}

function sha256Hex_(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytesAHex_(bytes);
}

/** computeDigest entrega bytes con signo (-128..127): se convierten a 0..255. */
function bytesAHex_(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    hex += ((bytes[i] & 0xff) + 0x100).toString(16).slice(1);
  }
  return hex;
}

/** Comparación de largo constante para no filtrar información por tiempos. */
function compararSeguro_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diferencia = 0;
  for (var i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

/** Valor aleatorio en hex a partir de UUID v4 (122 bits aleatorios cada uno). */
function aleatorioHex_(cantidadUuid) {
  var s = '';
  for (var i = 0; i < cantidadUuid; i++) s += Utilities.getUuid().replace(/-/g, '');
  return s;
}

function generarToken_() {
  return aleatorioHex_(2);
}

function obtenerPepper_() {
  var pepper = PropertiesService.getScriptProperties().getProperty('PEPPER');
  if (!pepper) throw new Error('Falta la configuración inicial (PEPPER).');
  return pepper;
}

/** Devuelve { usuario, rol } si el token es válido y el usuario sigue activo; si no, null. */
function validarSesion_(token) {
  if (!esTexto_(token, 20, 200)) return null;
  var props = PropertiesService.getScriptProperties();
  var clave = PREFIJO_SESION + sha256Hex_(token);
  var guardado = props.getProperty(clave);
  if (!guardado) return null;
  var sesion;
  try {
    sesion = JSON.parse(guardado);
  } catch (e) {
    props.deleteProperty(clave);
    return null;
  }
  if (!sesion || typeof sesion.e !== 'number' || sesion.e < Date.now()) {
    props.deleteProperty(clave);
    return null;
  }
  var usuario = buscarUsuario_(sesion.u);
  if (!usuario || usuario.activo !== 'SI') return null;
  return { usuario: usuario.usuario, rol: usuario.rol };
}

function limpiarSesionesVencidas_() {
  var props = PropertiesService.getScriptProperties();
  var todas = props.getProperties();
  var ahora = Date.now();
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf(PREFIJO_SESION) !== 0) return;
    try {
      if (JSON.parse(todas[k]).e < ahora) props.deleteProperty(k);
    } catch (e) {
      props.deleteProperty(k);
    }
  });
}

/** Cierra todas las sesiones de un usuario (al desactivarlo o cambiar su contraseña). */
function cerrarSesionesDe_(nombreNormalizado) {
  var props = PropertiesService.getScriptProperties();
  var todas = props.getProperties();
  var cerradas = 0;
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf(PREFIJO_SESION) !== 0) return;
    try {
      if (JSON.parse(todas[k]).u === nombreNormalizado) {
        props.deleteProperty(k);
        cerradas++;
      }
    } catch (e) {
      props.deleteProperty(k);
    }
  });
  return cerradas;
}

// ---------- Límite de intentos (CacheService) ----------

function claveCache_(prefijo, nombre) {
  // Las claves de caché tienen largo máximo: se usa el hash del nombre
  return prefijo + sha256Hex_(nombre).slice(0, 32);
}

function estaBloqueado_(nombre) {
  return CacheService.getScriptCache().get(claveCache_('bloqueo_', nombre)) !== null;
}

function registrarFallo_(nombre) {
  var cache = CacheService.getScriptCache();
  var clave = claveCache_('fallos_', nombre);
  var fallos = Number(cache.get(clave) || 0) + 1;
  if (fallos >= MAX_FALLOS) {
    cache.put(claveCache_('bloqueo_', nombre), '1', SEGUNDOS_BLOQUEO);
    cache.remove(clave);
  } else {
    cache.put(clave, String(fallos), SEGUNDOS_BLOQUEO);
  }
}

function limpiarFallos_(nombre) {
  CacheService.getScriptCache().remove(claveCache_('fallos_', nombre));
}

// ======================================================================
// Utilidades de la hoja
// ======================================================================

function obtenerHoja_(nombre) {
  var id = PropertiesService.getScriptProperties().getProperty('ID_HOJA');
  if (!id) throw new Error('Falta la configuración inicial (ID_HOJA).');
  var hoja = SpreadsheetApp.openById(id).getSheetByName(nombre);
  if (!hoja) throw new Error('No existe la hoja ' + nombre);
  return hoja;
}

/** Busca una fila previa con los mismos 3 campos (por TextFinder en la columna Pallet). */
function buscarDuplicado_(hoja, ultima, pedido, producto, pallet) {
  if (ultima < 2) return null;
  var celdas = hoja.getRange(2, COL_PALLET, ultima - 1, 1)
    .createTextFinder(pallet).matchEntireCell(true).matchCase(true).findAll();
  var encontrado = null;
  for (var i = 0; i < celdas.length; i++) {
    var fila = hoja.getRange(celdas[i].getRow(), 1, 1, NUM_COLUMNAS).getValues()[0];
    if (sinApostrofo_(fila[COL_PEDIDO - 1]) === pedido &&
        sinApostrofo_(fila[COL_PRODUCTO - 1]) === producto &&
        sinApostrofo_(fila[COL_PALLET - 1]) === pallet) {
      encontrado = fila; // se queda con la más reciente
    }
  }
  if (!encontrado) return null;
  return {
    correlativo: encontrado[COL_CORRELATIVO - 1],
    usuario: encontrado[COL_USUARIO - 1],
    fecha: formatearFecha_(encontrado[COL_FECHA - 1])
  };
}

function formatearFecha_(valor) {
  return valor instanceof Date ? Utilities.formatDate(valor, ZONA, FORMATO_FECHA) : String(valor);
}

/** Evita que un texto que empieza con = + - @ se interprete como fórmula. */
function neutralizar_(texto) {
  return /^[=+\-@]/.test(texto) ? "'" + texto : texto;
}

function sinApostrofo_(valor) {
  var s = String(valor);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

function esTexto_(valor, minimo, maximo) {
  return typeof valor === 'string' && valor.trim().length >= minimo && valor.length <= maximo;
}

function recortar_(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

// ======================================================================
// Menú de la hoja (solo para el dueño)
// ======================================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Lector QR')
    .addItem('Configuración inicial', 'configuracionInicial')
    .addItem('Cargar usuarios', 'mostrarCargarUsuarios')
    .addItem('Desactivar o reactivar usuario', 'desactivarOReactivarUsuario')
    .addToUi();
}

/** Crea las hojas, el pepper y guarda el ID de la hoja. Se puede repetir sin perder datos. */
function configuracionInicial() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ID_HOJA', ss.getId());
  if (!props.getProperty('PEPPER')) props.setProperty('PEPPER', aleatorioHex_(2));
  ss.setSpreadsheetTimeZone(ZONA);

  var usuarios = prepararHoja_(ss, HOJA_USUARIOS, ENCABEZADOS_USUARIOS);
  usuarios.getRange(1, 1, usuarios.getMaxRows(), ENCABEZADOS_USUARIOS.length).setNumberFormat('@');

  var lecturas = prepararHoja_(ss, HOJA_LECTURAS, ENCABEZADOS_LECTURAS);
  var filas = lecturas.getMaxRows();
  // Texto plano: conserva ceros a la izquierda y evita fórmulas
  [COL_PEDIDO, COL_PRODUCTO, COL_PALLET, COL_USUARIO, COL_OBSERVACION, COL_ID].forEach(function (c) {
    lecturas.getRange(2, c, filas - 1, 1).setNumberFormat('@');
  });
  lecturas.getRange(2, COL_CORRELATIVO, filas - 1, 1).setNumberFormat('0');
  lecturas.getRange(2, COL_FECHA, filas - 1, 1).setNumberFormat(FORMATO_FECHA);
  // La columna ID queda VISIBLE: la búsqueda de IDs repetidos no debe depender
  // de cómo trata TextFinder las columnas ocultas (si se ocultó en una versión anterior, se muestra)
  lecturas.showColumns(COL_ID);

  SpreadsheetApp.getUi().alert('Configuración lista.\n\nAhora usa "Lector QR → Cargar usuarios" ' +
    'y luego implementa el script como aplicación web.');
}

function prepararHoja_(ss, nombre, encabezados) {
  var hoja = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  if (hoja.getLastRow() === 0) {
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function mostrarCargarUsuarios() {
  var html = HtmlService.createHtmlOutput(
    '<style>body{font-family:sans-serif;font-size:14px}textarea{width:100%;height:220px;font-family:monospace}' +
    'button{margin-top:8px;padding:8px 16px;font-size:14px}#r{margin-top:8px;white-space:pre-wrap}</style>' +
    '<p>Pega las líneas de <b>privado/credenciales.txt</b> (formato <code>usuario;contraseña;rol</code>). ' +
    'Las líneas que empiezan con # se ignoran.</p>' +
    '<textarea id="t" autocomplete="off" spellcheck="false"></textarea>' +
    '<button id="b" onclick="cargar()">Cargar</button><div id="r"></div>' +
    '<script>function cargar(){var b=document.getElementById("b");b.disabled=true;' +
    'document.getElementById("r").textContent="Procesando…";' +
    'google.script.run.withSuccessHandler(function(m){document.getElementById("t").value="";' +
    'document.getElementById("r").textContent=m;b.disabled=false;})' +
    '.withFailureHandler(function(e){document.getElementById("r").textContent="Error: "+e.message;b.disabled=false;})' +
    '.procesarCredenciales(document.getElementById("t").value);}</script>'
  ).setWidth(520).setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(html, 'Cargar usuarios');
}

/**
 * Crea o actualiza usuarios desde texto "usuario;contraseña;rol" (una línea por usuario).
 * Cada carga genera una sal nueva y cierra las sesiones abiertas de ese usuario.
 * Devuelve un resumen sin contraseñas.
 */
function procesarCredenciales(texto) {
  var pepper = obtenerPepper_();
  var hoja = obtenerHoja_(HOJA_USUARIOS);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ultima = hoja.getLastRow();
    var existentes = {};
    if (ultima > 1) {
      hoja.getRange(2, 1, ultima - 1, 1).getValues().forEach(function (f, i) {
        existentes[normalizarUsuario_(f[0])] = i + 2;
      });
    }
    var creados = 0, actualizados = 0, errores = [];
    String(texto || '').split(/\r?\n/).forEach(function (linea, i) {
      var l = linea.trim();
      if (!l || l.charAt(0) === '#') return;
      var partes = l.split(';');
      var usuario = (partes[0] || '').trim();
      var clave = partes[1] || '';
      var rol = (partes[2] || 'USUARIO').trim().toUpperCase();
      if (partes.length < 2 || !/^[A-Za-z0-9_.-]{1,50}$/.test(usuario) ||
          clave.length < MIN_CLAVE_NUEVA || clave.length > MAX_CLAVE ||
          (rol !== 'ADMIN' && rol !== 'USUARIO')) {
        errores.push(i + 1);
        return;
      }
      var nombre = normalizarUsuario_(usuario);
      var sal = aleatorioHex_(1);
      var hash = calcularHash_(pepper, sal, nombre, clave);
      var fila = existentes[nombre];
      if (fila) {
        hoja.getRange(fila, 2, 1, 2).setValues([[sal, hash]]);
        hoja.getRange(fila, 5).setValue(rol);
        actualizados++;
      } else {
        fila = hoja.getLastRow() + 1;
        hoja.getRange(fila, 1, 1, 5).setValues([[usuario, sal, hash, 'SI', rol]]);
        existentes[nombre] = fila;
        creados++;
      }
      cerrarSesionesDe_(nombre);
    });
    SpreadsheetApp.flush();
    var msg = 'Creados: ' + creados + '\nActualizados: ' + actualizados;
    if (errores.length) msg += '\nLíneas con error (revisar formato o largo mínimo de ' +
      MIN_CLAVE_NUEVA + '): ' + errores.join(', ');
    return msg;
  } finally {
    lock.releaseLock();
  }
}

function desactivarOReactivarUsuario() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Desactivar o reactivar usuario', 'Nombre de usuario:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var nombre = normalizarUsuario_(r.getResponseText());
  var usuario = buscarUsuario_(nombre);
  if (!usuario) {
    ui.alert('No existe el usuario "' + r.getResponseText().trim() + '".');
    return;
  }
  var nuevo = usuario.activo === 'SI' ? 'NO' : 'SI';
  obtenerHoja_(HOJA_USUARIOS).getRange(usuario.fila, 4).setValue(nuevo);
  var cerradas = nuevo === 'NO' ? cerrarSesionesDe_(nombre) : 0;
  ui.alert('Usuario ' + usuario.usuario + ': ' + (nuevo === 'SI' ? 'REACTIVADO' : 'DESACTIVADO') +
    (nuevo === 'NO' ? '\nSesiones cerradas: ' + cerradas : ''));
}
