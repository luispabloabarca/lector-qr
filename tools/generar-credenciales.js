/*
 * Genera las credenciales de los usuarios en privado/credenciales.txt (texto plano).
 * Formato de cada línea: usuario;contraseña;rol
 *
 * Uso:
 *   node tools/generar-credenciales.js            -> crea admin y User01..User30 (no sobrescribe)
 *   node tools/generar-credenciales.js --forzar   -> regenera TODAS (invalida las ya repartidas)
 *   node tools/generar-credenciales.js User07     -> regenera solo ese usuario
 *
 * La carpeta privado/ está en .gitignore: nunca se sube al repositorio.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Sin caracteres que se confunden al leerlos: 0 O 1 l I
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS = '23456789';
const ALFABETO = MAYUSCULAS + MINUSCULAS + DIGITOS;
const LARGO = 12;
const CANTIDAD_USUARIOS = 30;

const ARCHIVO = path.join(__dirname, '..', 'privado', 'credenciales.txt');

function elegir(conjunto) {
  return conjunto[crypto.randomInt(conjunto.length)];
}

/** Contraseña aleatoria de 12 caracteres con al menos una mayúscula, una minúscula y un dígito. */
function generarClave() {
  const chars = [elegir(MAYUSCULAS), elegir(MINUSCULAS), elegir(DIGITOS)];
  while (chars.length < LARGO) chars.push(elegir(ALFABETO));
  // Mezcla Fisher-Yates para que los obligatorios no queden siempre al inicio
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function listaUsuarios() {
  const lista = [{ usuario: 'admin', rol: 'ADMIN' }];
  for (let n = 1; n <= CANTIDAD_USUARIOS; n++) {
    lista.push({ usuario: 'User' + String(n).padStart(2, '0'), rol: 'USUARIO' });
  }
  return lista;
}

function encabezado() {
  return [
    '# Credenciales del Lector QR. NO subir a GitHub, NO compartir este archivo completo.',
    '# Formato: usuario;contraseña;rol',
    '# Para cargarlas: en la hoja, menú Lector QR -> Cargar usuarios, y pegar las líneas.',
    '# Generado: ' + new Date().toISOString(),
    ''
  ];
}

function main(args) {
  const forzar = args.includes('--forzar');
  const nombre = args.find((a) => !a.startsWith('--'));
  fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });

  if (nombre) {
    if (!/^[A-Za-z0-9_.-]{1,50}$/.test(nombre)) {
      console.error('Nombre de usuario inválido.');
      process.exit(1);
    }
    const existe = fs.existsSync(ARCHIVO);
    const lineas = existe ? fs.readFileSync(ARCHIVO, 'utf8').split(/\r?\n/) : encabezado();
    const conocido = listaUsuarios().find((u) => u.usuario.toLowerCase() === nombre.toLowerCase());
    let rol = conocido ? conocido.rol : 'USUARIO';
    let usuario = conocido ? conocido.usuario : nombre;
    const nueva = (u, r) => `${u};${generarClave()};${r}`;
    let reemplazada = null;
    for (let i = 0; i < lineas.length; i++) {
      const partes = lineas[i].split(';');
      if (!lineas[i].startsWith('#') && partes[0].toLowerCase() === nombre.toLowerCase()) {
        usuario = partes[0];
        rol = partes[2] || rol;
        lineas[i] = reemplazada = nueva(usuario, rol);
      }
    }
    if (!reemplazada) {
      reemplazada = nueva(usuario, rol);
      while (lineas.length && lineas[lineas.length - 1] === '') lineas.pop();
      lineas.push(reemplazada, '');
    }
    fs.writeFileSync(ARCHIVO, lineas.join('\n'), 'utf8');
    console.log('Nueva credencial (pégala en Lector QR -> Cargar usuarios):');
    console.log(reemplazada);
    return;
  }

  if (fs.existsSync(ARCHIVO) && !forzar) {
    console.error('Ya existe privado/credenciales.txt. Para regenerar TODAS usa --forzar,');
    console.error('o indica un usuario: node tools/generar-credenciales.js User07');
    process.exit(1);
  }
  const lineas = encabezado().concat(
    listaUsuarios().map((u) => `${u.usuario};${generarClave()};${u.rol}`), ['']
  );
  fs.writeFileSync(ARCHIVO, lineas.join('\n'), 'utf8');
  console.log(`Credenciales generadas en ${path.relative(process.cwd(), ARCHIVO)} (${CANTIDAD_USUARIOS + 1} usuarios).`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { generarClave, listaUsuarios, ALFABETO, LARGO };
