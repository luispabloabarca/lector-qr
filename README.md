# Lector QR de pallets → Google Sheets

Aplicación web (PWA) para leer con el celular los códigos QR de los pallets y registrar cada lectura en una hoja de Google Sheets.

- **Frontend:** página estática en GitHub Pages (carpeta `docs/`). JavaScript simple, sin frameworks y sin paso de build.
- **Backend:** Google Apps Script ligado a la hoja y publicado como aplicación web. No hay servidor propio.
- **Datos:** la hoja de Google Sheets en tu Drive. Los usuarios nunca la ven: solo escriben a través del script.
- **Sin conexión no se registra nada.** La app avisa y bloquea el envío, y no guarda lecturas pendientes en el celular.

Formato del QR: `pedido;producto;pallet`. Ejemplo: `RENDIC: 20260922;719638;325` es el pallet `325` del producto `719638` del pedido `RENDIC: 20260922`.

---

## Índice

1. [Crear la hoja y el script](#1-crear-la-hoja-y-el-script)
2. [Configuración inicial](#2-configuración-inicial)
3. [Crear los usuarios](#3-crear-los-usuarios)
4. [Implementar como aplicación web](#4-implementar-como-aplicación-web)
5. [Publicar la app en GitHub Pages](#5-publicar-la-app-en-github-pages)
6. [Entregar el acceso a cada persona](#6-entregar-el-acceso-a-cada-persona)
7. [Tareas habituales](#7-tareas-habituales)
8. [Límites conocidos](#8-límites-conocidos)
9. [Desarrollo y pruebas](#9-desarrollo-y-pruebas)
10. [Referencia técnica](#10-referencia-técnica)

---

## 1. Crear la hoja y el script

1. Entra a <https://sheets.google.com> con tu cuenta y crea una **hoja en blanco**. Ponle un nombre, por ejemplo `Lector QR - Lecturas`.
2. En la hoja abre **Extensiones → Apps Script**. Se abre el editor del script ligado a esa hoja.
3. En el editor, borra el contenido de `Código.gs` y pega **todo** el contenido de [`apps-script/Code.gs`](apps-script/Code.gs). Guarda con el ícono del disquete o Ctrl+S.
4. Muestra el archivo de manifiesto: ⚙️ **Configuración del proyecto** → activa **"Mostrar el archivo de manifiesto appsscript.json en el editor"**.
5. Vuelve al **Editor** (ícono `< >`), abre `appsscript.json`, reemplaza su contenido por el de [`apps-script/appsscript.json`](apps-script/appsscript.json) y guarda.

## 2. Configuración inicial

1. Vuelve a la pestaña de la hoja y **recárgala** (F5). Aparece el menú **Lector QR** en la barra superior. Puede tardar unos segundos.
2. Elige **Lector QR → Configuración inicial**.
3. La primera vez Google pide autorización:
   - Pulsa **Continuar** y elige tu cuenta.
   - Si aparece "Google no verificó esta app", pulsa **Configuración avanzada → Ir a … (no seguro)**. Es normal: el script es tuyo y no está publicado en la tienda.
   - Pulsa **Permitir**.
4. Si después de autorizar no aparece el mensaje "Configuración lista", vuelve a elegir **Lector QR → Configuración inicial**.

Esto hace lo siguiente:

- Crea las hojas **Usuarios** y **Lecturas** con sus encabezados.
- Fija la zona horaria de la planilla en `America/Santiago`.
- Da formato de texto a las columnas de datos, para conservar ceros a la izquierda y evitar fórmulas.
- Deja visible la columna **ID**, que es interna y sirve para no duplicar reintentos. No la borres ni la ocultes.
- Guarda en las **propiedades del script** el ID de la hoja y un **pepper** aleatorio, el secreto que se usa para los hashes de las contraseñas.

Se puede volver a ejecutar sin perder datos y **no cambia el pepper** si ya existe.

> ⚠️ No borres la propiedad `PEPPER` (⚙️ Configuración del proyecto → Propiedades del script). Si se pierde, todas las contraseñas dejan de funcionar y hay que volver a cargar los usuarios.

La hoja **Lecturas** queda con estas columnas:

| Correlativo | N° pedido | Código producto | N° pallet | Usuario | Fecha y hora | Observación | ID (interna) |
|---|---|---|---|---|---|---|---|

## 3. Crear los usuarios

Las contraseñas se generan **en tu computador** y en la hoja solo se guarda su hash (con sal y pepper).

1. En este proyecto, en una terminal, ejecuta:

   ```bash
   npm run credenciales
   ```

   Esto crea `privado/credenciales.txt` con `admin` y `User01` a `User30`, cada uno con una contraseña aleatoria de 12 caracteres. Cada línea tiene el formato `usuario;contraseña;rol`. La carpeta `privado/` está en `.gitignore` y **nunca se sube a GitHub**.

   > Si este paso ya se ejecutó durante la instalación, el archivo ya existe y el comando se niega a sobrescribirlo. Es así para no invalidar contraseñas que ya repartiste.

2. Abre `privado/credenciales.txt` y copia todo su contenido.
3. En la hoja: **Lector QR → Cargar usuarios**, pega el texto y pulsa **Cargar**. Debe decir `Creados: 31`.
4. Guarda `privado/credenciales.txt` en un lugar seguro, o bórralo cuando hayas repartido las contraseñas.

El usuario **admin** escanea igual que los demás. Además ve el **resumen del día** (total de lecturas y cantidad por usuario) y el botón **Descargar copia completa**, que baja un CSV que se abre en Excel.

## 4. Implementar como aplicación web

1. En el editor de Apps Script: **Implementar → Nueva implementación**.
2. En ⚙️ **Seleccionar tipo**, elige **Aplicación web**.
3. Completa:
   - **Descripción:** `v1`
   - **Ejecutar como:** **Yo** (tu cuenta)
   - **Quién tiene acceso:** **Cualquier persona**
4. Pulsa **Implementar** y copia la **URL de la aplicación web**. Tiene la forma `https://script.google.com/macros/s/XXXXXXXX/exec`.
5. Prueba: abre esa URL en el navegador. Debe mostrar `{"ok":true,"servicio":"Lector QR"}`.

> Esta URL **no se guarda en el repositorio**. Es la "llave" para escribir en tu hoja: compártela solo con quienes deben usar la app.

### Publicar una nueva versión después de cambiar el código (sin cambiar la URL)

Si modificas `Code.gs`, guardarlo **no basta**: la aplicación web sigue usando la versión anterior.

1. **Implementar → Administrar implementaciones**.
2. Selecciona la implementación activa y pulsa ✏️ **Editar**.
3. En **Versión**, elige **Nueva versión** y pulsa **Implementar**.

La URL se mantiene y nadie tiene que cambiar nada en su celular.

## 5. Publicar la app en GitHub Pages

El repositorio ya está creado y publicado (ver el final de este documento). Si algún día tienes que hacerlo desde cero:

1. Crea un repositorio **público** en GitHub. Pages gratuito exige que sea público, y no contiene secretos.
2. Sube el proyecto:

   ```bash
   git push -u origin main
   ```

3. En GitHub: **Settings → Pages → Build and deployment**. En **Source** elige **Deploy from a branch**, y luego **Branch: `main`** y la carpeta **`/docs`**. Guarda.
4. En uno o dos minutos la app queda en `https://<tu-usuario>.github.io/<repositorio>/`.

### Cuando cambies archivos de `docs/`

Sube el número de `VERSION` en [`docs/sw.js`](docs/sw.js), por ejemplo de `lector-qr-v1` a `lector-qr-v2`, antes de hacer commit y push. Sin eso, los celulares que ya tienen la app instalada siguen usando la versión guardada.

## 6. Entregar el acceso a cada persona

Envía a cada persona **dos mensajes de WhatsApp separados**:

1. **Mensaje 1 (igual para todos):** la dirección de la app y la URL del script:

   ```
   App: https://<tu-usuario>.github.io/lector-qr/
   URL del servidor (pégala en la app): https://script.google.com/macros/s/XXXXXXXX/exec
   ```

2. **Mensaje 2 (personal):** su usuario y contraseña, por ejemplo `Usuario: User07` y `Contraseña: Ab3dEfGh5jkm`.

Instrucciones para la persona:

- **Android (Chrome):** abre el enlace de la app y elige ⋮ → **Instalar app** (o **Agregar a la pantalla principal**). Abre la app instalada, pega la URL del servidor, escribe tu usuario y contraseña, pulsa **Entrar** y permite el uso de la cámara.
- **iPhone (Safari):** abre el enlace **en Safari**, pulsa **Compartir** → **Agregar a inicio**. **Abre la app desde el ícono** y recién ahí pega la URL e ingresa. La app instalada no comparte datos con Safari, así que lo que ingreses en Safari no aparece en la app.

La sesión dura **30 días**. Después la app pide usuario y contraseña de nuevo, y la URL queda guardada.

## 7. Tareas habituales

### Desactivar o reactivar un usuario
En la hoja: **Lector QR → Desactivar o reactivar usuario** y escribe el nombre, por ejemplo `User07`.
- Al desactivarlo se cierran **de inmediato** sus sesiones. Ya no puede registrar ni entrar.
- Al repetir la misma opción, el usuario se reactiva.

### Cambiar la contraseña de un usuario (por ejemplo, si la olvidó)

```bash
node tools/generar-credenciales.js User07
```

El comando muestra la nueva línea `User07;…;USUARIO`. Pégala en **Lector QR → Cargar usuarios**. Se cierran sus sesiones abiertas y la contraseña anterior deja de funcionar.

### Agregar un usuario nuevo
Ejecuta `node tools/generar-credenciales.js User31` y carga la línea igual que en el caso anterior.

### Invalidar una URL filtrada
Si la URL del script llegó a quien no debía:

1. **Implementar → Nueva implementación** (aplicación web, igual que en el paso 4). Esto genera una **URL nueva**.
2. **Implementar → Administrar implementaciones**, selecciona la implementación **anterior** y pulsa **Archivar**. Desde ese momento la URL vieja deja de funcionar.
3. Envía la URL nueva a los usuarios legítimos. Cada uno debe **Cerrar sesión** en la app y volver a entrar con la URL nueva.

Si además sospechas que se filtraron contraseñas, regenera todas:

```bash
node tools/generar-credenciales.js --forzar
```

Luego cárgalas de nuevo en la hoja.

### Respaldo
El admin puede usar **Descargar copia completa** en la app (CSV para Excel). También puedes usar **Archivo → Descargar** en la hoja, o **Archivo → Historial de versiones**.

### Lecturas duplicadas
Si se escanea un pallet con el mismo pedido, producto y pallet que una lectura anterior, la app avisa quién y cuándo lo registró, y pregunta si se quiere registrar igual. En ese caso exige una observación. **Nunca se sobrescribe una fila**: se agrega una fila nueva con la observación.

## 8. Límites conocidos

- **Cuotas de Apps Script (cuenta Gmail gratuita):** Google publica los límites vigentes en <https://developers.google.com/apps-script/guides/services/quotas>. Los relevantes aquí son:
  - Unas 30 ejecuciones simultáneas por usuario del script.
  - 6 minutos como máximo por ejecución. Cada lectura toma alrededor de 1 segundo.
  - Si hay muchas lecturas al mismo tiempo, algunas pueden responder "servidor ocupado". Se reintenta sin duplicar.
  - Para 31 usuarios con uso normal, estos límites no deberían alcanzarse.
- **Tamaño de la hoja:** una planilla admite como máximo 10 millones de celdas. Con 8 columnas son más de un millón de lecturas, pero el rendimiento empieza a bajar mucho antes, alrededor de cientos de miles de filas. Recomendación: una vez al año, descarga una copia, mueve las filas antiguas a otra planilla y conserva el correlativo.
- **Bloqueo por intentos:** 5 contraseñas incorrectas en 10 minutos bloquean ese usuario durante 10 minutos. Quien conozca un nombre de usuario podría bloquearlo a propósito; Apps Script no entrega la IP, así que no se puede limitar por origen.
- **Sin conexión no se registra nada.** Es una decisión de diseño: no hay lecturas pendientes en el celular.
- **iPhone/iPad:**
  - No hay botón de linterna (Safari no lo permite).
  - No hay vibración.
  - La app instalada no comparte datos con Safari.
  - Si la app no se usa en varias semanas, iOS puede borrar sus datos, y entonces hay que volver a ingresar la URL y la contraseña.
- **La cámara requiere https.** GitHub Pages ya lo cumple.
- **Seguridad:** la URL del script más un usuario y contraseña válidos permiten registrar lecturas. Las contraseñas se guardan como hash SHA-256 con sal individual y pepper secreto. En el celular se guarda un token de sesión, **nunca la contraseña**.

## 9. Desarrollo y pruebas

Requisitos: Node.js 20 o superior.

```bash
npm install          # instala html5-qrcode 2.3.8 (única dependencia, solo de desarrollo)
npm run vendor       # copia la librería a docs/vendor/
npm run iconos       # regenera los íconos en docs/icons/
npm test             # pruebas automáticas (node:test)
npm run check        # node --check sobre todos los archivos JS y Code.gs
npm run servidor     # sirve docs/ en http://localhost:8080/
```

- `tests/backend.test.js` ejecuta el **`Code.gs` real** en Node, con los servicios de Apps Script simulados (`tests/mocks-apps-script.js`).
- `tests/logica.test.js` prueba la lógica compartida de `docs/lib/logica.js`: validación de URL, lectura del QR, anti doble lectura, UUID y CSV.
- `tests/credenciales.test.js` prueba el generador de contraseñas.

## 10. Referencia técnica

### Estructura

```
docs/                 App publicada en GitHub Pages
  index.html          Pantallas de acceso y lector
  app.js              Lógica de la interfaz
  lib/logica.js       Lógica pura (navegador y Node)
  styles.css          Estilos (modo claro/oscuro automático)
  sw.js               Service worker (caché versionado)
  manifest.webmanifest
  icons/              Íconos de la PWA
  vendor/             html5-qrcode 2.3.8
apps-script/          Code.gs y appsscript.json (pegar en el editor de Apps Script)
tools/                Scripts de Node (credenciales, íconos, servidor local, verificación)
tests/                Pruebas automáticas
privado/              Credenciales en texto plano (NO se sube a git)
```

### API del script (POST, cuerpo JSON con `Content-Type: text/plain`)

| action | Datos | Respuesta OK |
|---|---|---|
| `login` | `usuario`, `clave` | `token`, `usuario`, `rol`, `expira` |
| `logout` | `token` | — |
| `lectura` | `token`, `id` (UUID), `pedido`, `producto`, `pallet`, `observacion`, `confirmarDuplicado` | `correlativo`, `usuario`, `fecha` (`repetido:true` si el ID ya existía) |
| `resumen` (admin) | `token` | `fecha`, `total`, `porUsuario[]` |
| `exportar` (admin) | `token` | `filas[][]` (sin columna ID) |

Errores (`{ ok:false, error }`): `CREDENCIALES`, `INACTIVO`, `BLOQUEADO`, `SESION`, `DUPLICADO` (incluye `previo`), `OBSERVACION_REQUERIDA`, `QR_INVALIDO`, `ENTRADA_INVALIDA`, `ACCION_DESCONOCIDA`, `NO_AUTORIZADO`, `OCUPADO`, `INTERNO`.
