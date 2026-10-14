/*
 * Simulación mínima de los servicios de Apps Script para probar el Code.gs real en Node.
 * Solo implementa lo que usa Code.gs.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function formatearFecha(fecha, zona, formato) {
  const partes = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(fecha).forEach((p) => { partes[p.type] = p.value; });
  return formato
    .replace('yyyy', partes.year).replace('MM', partes.month).replace('dd', partes.day)
    .replace('HH', partes.hour).replace('mm', partes.minute).replace('ss', partes.second);
}

class HojaFalsa {
  constructor(nombre) {
    this.nombre = nombre;
    this.datos = [];
    this.columnasOcultas = [];
  }
  getLastRow() { return this.datos.length; }
  getMaxRows() { return 1000; }
  getRange(fila, col, nFilas = 1, nCols = 1) { return new RangoFalso(this, fila, col, nFilas, nCols); }
  setFrozenRows() { return this; }
  hideColumns(c) { this.columnasOcultas.push(c); return this; }
  showColumns(c) { this.columnasOcultas = this.columnasOcultas.filter((x) => x !== c); return this; }
  celda(f, c) {
    const fila = this.datos[f - 1];
    return fila && fila[c - 1] !== undefined ? fila[c - 1] : '';
  }
  escribir(f, c, v) {
    while (this.datos.length < f) this.datos.push([]);
    this.datos[f - 1][c - 1] = v;
  }
}

class RangoFalso {
  constructor(hoja, fila, col, nFilas, nCols) {
    Object.assign(this, { hoja, fila, col, nFilas, nCols });
  }
  getRow() { return this.fila; }
  getValues() {
    const r = [];
    for (let i = 0; i < this.nFilas; i++) {
      const f = [];
      for (let j = 0; j < this.nCols; j++) f.push(this.hoja.celda(this.fila + i, this.col + j));
      r.push(f);
    }
    return r;
  }
  getDisplayValues() {
    return this.getValues().map((f) => f.map((v) =>
      v instanceof Date ? formatearFecha(v, 'America/Santiago', 'dd-MM-yyyy HH:mm:ss') : String(v)));
  }
  getValue() { return this.hoja.celda(this.fila, this.col); }
  setValue(v) { this.hoja.escribir(this.fila, this.col, v); return this; }
  setValues(valores) {
    valores.forEach((f, i) => f.forEach((v, j) => this.hoja.escribir(this.fila + i, this.col + j, v)));
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  createTextFinder(texto) {
    const rango = this;
    const buscador = {
      matchEntireCell() { return buscador; },
      matchCase() { return buscador; },
      findAll() {
        const r = [];
        for (let i = 0; i < rango.nFilas; i++) {
          for (let j = 0; j < rango.nCols; j++) {
            // Peor caso: se asume que TextFinder NO encuentra celdas en columnas ocultas
            if (rango.hoja.columnasOcultas.includes(rango.col + j)) continue;
            if (String(rango.hoja.celda(rango.fila + i, rango.col + j)) === texto) {
              r.push(new RangoFalso(rango.hoja, rango.fila + i, rango.col + j, 1, 1));
            }
          }
        }
        return r;
      },
      findNext() { return buscador.findAll()[0] || null; }
    };
    return buscador;
  }
}

/** Crea un contexto con Code.gs cargado y las hojas ya preparadas. */
function crearEntorno() {
  const props = new Map();
  const cache = new Map();
  const registros = [];
  const hojas = {
    Usuarios: new HojaFalsa('Usuarios'),
    Lecturas: new HojaFalsa('Lecturas')
  };
  const libro = {
    getId: () => 'ID-HOJA-PRUEBA',
    getSheetByName: (n) => hojas[n] || null,
    insertSheet: (n) => (hojas[n] = new HojaFalsa(n)),
    setSpreadsheetTimeZone() {}
  };
  const reloj = { desfaseMs: 0 };

  const contexto = {
    Date, JSON, Math, Object, Array, String, Number, isNaN,
    console: {
      log: (...a) => registros.push(a.join(' ')),
      error: (...a) => registros.push(a.join(' ')),
      warn: (...a) => registros.push(a.join(' '))
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest(alg, texto) {
        // Igual que Apps Script: bytes con signo
        return Array.from(crypto.createHash(alg).update(texto, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b));
      },
      getUuid: () => crypto.randomUUID(),
      formatDate: formatearFecha
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
        getProperties: () => Object.fromEntries(props)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => {
          const e = cache.get(k);
          if (!e || e.vence < Date.now() + reloj.desfaseMs) return null;
          return e.valor;
        },
        put: (k, v, seg) => { cache.set(k, { valor: v, vence: Date.now() + reloj.desfaseMs + seg * 1000 }); },
        remove: (k) => { cache.delete(k); }
      })
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} })
    },
    SpreadsheetApp: {
      openById: () => libro,
      getActiveSpreadsheet: () => libro,
      flush() {}
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(s) {
        return { contenido: s, setMimeType() { return this; }, getContent() { return s; } };
      }
    }
  };
  vm.createContext(contexto);
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(codigo, contexto, { filename: 'Code.gs' });

  // Estado equivalente a haber corrido "Configuración inicial"
  props.set('ID_HOJA', 'ID-HOJA-PRUEBA');
  props.set('PEPPER', 'pepper-de-prueba-123');
  hojas.Usuarios.getRange(1, 1, 1, 5).setValues([contexto.ENCABEZADOS_USUARIOS]);
  hojas.Lecturas.getRange(1, 1, 1, 8).setValues([contexto.ENCABEZADOS_LECTURAS]);

  /** Llama a doPost como lo haría la aplicación web y devuelve el JSON parseado. */
  function post(cuerpo) {
    const contenido = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    return JSON.parse(contexto.doPost({ postData: { contents: contenido } }).getContent());
  }

  return { gs: contexto, props, cache, hojas, registros, reloj, post };
}

module.exports = { crearEntorno, formatearFecha };
