/*
 * Lector QR - lógica de la interfaz.
 * Sin conexión no se registra ni se guarda ninguna lectura pendiente.
 * En el dispositivo solo se guardan: URL del servidor, usuario, token de sesión,
 * rol y las últimas 10 lecturas (para mostrarlas). Nunca la contraseña.
 */
(function () {
  'use strict';

  var L = window.Logica;
  // Apps Script puede tardar bastante en "despertar" (arranque en frío): se espera hasta 30 s
  var TIMEOUT_MS = 30000;
  var MAX_ULTIMAS = 10;
  var CLAVES = {
    url: 'lqr_url', usuario: 'lqr_usuario', token: 'lqr_token', rol: 'lqr_rol',
    ultimas: 'lqr_ultimas', reintento: 'lqr_reintento'
  };

  var MENSAJES = {
    CREDENCIALES: 'Usuario o contraseña incorrectos.',
    INACTIVO: 'Tu usuario está desactivado. Habla con el administrador.',
    BLOQUEADO: 'Demasiados intentos fallidos. Espera 10 minutos e intenta de nuevo.',
    SESION: 'Tu sesión expiró. Ingresa de nuevo.',
    QR_INVALIDO: 'QR no válido: debe tener pedido;producto;pallet.',
    ENTRADA_INVALIDA: 'Datos no válidos. Revisa los campos.',
    OBSERVACION_REQUERIDA: 'Debes escribir una observación.',
    NO_AUTORIZADO: 'No tienes permiso para esta acción.',
    ACCION_DESCONOCIDA: 'El servidor no reconoce la acción. Avisa al administrador (versión del script).',
    OCUPADO: 'El servidor está ocupado. Intenta de nuevo en unos segundos.',
    INTERNO: 'Error del servidor. Avisa al administrador.',
    RED: 'No se pudo confirmar el registro (sin conexión con el servidor). Revisa tu señal y vuelve a intentarlo: no se duplicará.',
    TIEMPO: 'El servidor tardó demasiado y no se confirmó el registro. Vuelve a intentarlo: no se duplicará.',
    RESPUESTA_INVALIDA: 'Respuesta inesperada del servidor. Revisa la URL o la implementación del script.'
  };

  // ---------- Referencias al DOM ----------
  function $(id) { return document.getElementById(id); }
  var el = {
    barraUsuario: $('barra-usuario'), nombreUsuario: $('nombre-usuario'), btnSalir: $('btn-salir'),
    avisoOffline: $('aviso-offline'),
    pantallaAcceso: $('pantalla-acceso'), formAcceso: $('form-acceso'),
    campoUrl: $('campo-url'), campoUsuario: $('campo-usuario'), campoClave: $('campo-clave'),
    btnVerClave: $('btn-ver-clave'), msgAcceso: $('msg-acceso'), btnEntrar: $('btn-entrar'),
    pantallaLector: $('pantalla-lector'), msgCamara: $('msg-camara'),
    btnCamara: $('btn-camara'), btnLinterna: $('btn-linterna'), resultado: $('resultado'),
    observacionRapida: $('observacion-rapida'),
    formManual: $('form-manual'), manualPedido: $('manual-pedido'), manualProducto: $('manual-producto'),
    manualPallet: $('manual-pallet'), manualObservacion: $('manual-observacion'), btnRegistrarManual: $('btn-registrar-manual'),
    listaUltimas: $('lista-ultimas'), sinLecturas: $('sin-lecturas'),
    panelAdmin: $('panel-admin'), resumen: $('resumen'), btnResumen: $('btn-resumen'),
    btnDescargar: $('btn-descargar'), msgAdmin: $('msg-admin'),
    dlg: $('dlg-duplicado'), formDup: $('form-duplicado'), dupTexto: $('dup-texto'), dupObs: $('dup-obs'),
    dupError: $('dup-error'), dupCancelar: $('dup-cancelar')
  };

  // ---------- Almacenamiento local (tolerante a fallos) ----------
  function leer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
  function borrar(k) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }

  // ---------- Estado ----------
  var estado = {
    ocupado: false,
    esRepetida: L.crearAntiDobleLectura(3000),
    lector: null,
    camaraActiva: false,
    linterna: false
  };

  /*
   * Última lectura sin confirmar (timeout o falla de red): { clave, id }.
   * Se guarda en el dispositivo para que, aunque se cierre la app, el reintento
   * de la misma lectura use el mismo ID y el servidor no la duplique.
   * No es una cola: no guarda lecturas para enviarlas después.
   */
  function leerReintento() {
    try { return JSON.parse(leer(CLAVES.reintento) || 'null'); } catch (e) { return null; }
  }
  function guardarReintento(valor) {
    if (valor) guardar(CLAVES.reintento, JSON.stringify(valor)); else borrar(CLAVES.reintento);
  }

  // ======================================================================
  // Comunicación con el servidor
  // ======================================================================

  /**
   * Envía una acción al Apps Script. Usa text/plain para evitar el preflight CORS;
   * fetch sigue la redirección de script.google.com a script.googleusercontent.com.
   * Siempre resuelve con un objeto { ok, error?, ... }.
   */
  function llamarServidor(accion, datos) {
    var url = leer(CLAVES.url);
    if (!url) return Promise.resolve({ ok: false, error: 'SESION' });
    var cuerpo = JSON.stringify(Object.assign({ action: accion }, datos));
    var control = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var temporizador = control ? setTimeout(function () { control.abort(); }, TIMEOUT_MS) : null;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: cuerpo,
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      signal: control ? control.signal : undefined
    }).then(function (resp) {
      return resp.text().then(function (texto) {
        try {
          var json = JSON.parse(texto);
          if (json && typeof json.ok === 'boolean') return json;
        } catch (e) { /* no era JSON (p. ej. página de error de Google) */ }
        return { ok: false, error: 'RESPUESTA_INVALIDA' };
      });
    }).catch(function (err) {
      return { ok: false, error: err && err.name === 'AbortError' ? 'TIEMPO' : 'RED' };
    }).then(function (r) {
      if (temporizador) clearTimeout(temporizador);
      return r;
    });
  }

  function mensajeDe(codigo) {
    return MENSAJES[codigo] || 'Error inesperado (' + codigo + ').';
  }

  // ======================================================================
  // Pantallas y sesión
  // ======================================================================

  function haySesion() {
    return !!(leer(CLAVES.url) && leer(CLAVES.usuario) && leer(CLAVES.token));
  }

  function mostrarAcceso(mensaje) {
    detenerCamara();
    el.pantallaLector.hidden = true;
    el.barraUsuario.hidden = true;
    el.pantallaAcceso.hidden = false;
    el.campoUrl.value = leer(CLAVES.url) || '';
    el.campoUsuario.value = leer(CLAVES.usuario) || '';
    el.campoClave.value = '';
    mostrarMensajeAcceso(mensaje || '');
    (el.campoUrl.value ? (el.campoUsuario.value ? el.campoClave : el.campoUsuario) : el.campoUrl).focus();
  }

  function mostrarLector() {
    el.pantallaAcceso.hidden = true;
    el.pantallaLector.hidden = false;
    el.barraUsuario.hidden = false;
    el.nombreUsuario.textContent = leer(CLAVES.usuario) || '';
    var esAdmin = leer(CLAVES.rol) === 'ADMIN';
    el.panelAdmin.hidden = !esAdmin;
    renderUltimas();
    actualizarConexion();
    iniciarCamara();
    if (esAdmin && navigator.onLine) cargarResumen();
  }

  function mostrarMensajeAcceso(texto) {
    el.msgAcceso.textContent = texto;
    el.msgAcceso.className = 'mensaje mensaje--error';
    el.msgAcceso.hidden = !texto;
  }

  function alEnviarAcceso(ev) {
    ev.preventDefault();
    desbloquearAudio();
    var url = L.validarUrlScript(el.campoUrl.value);
    var usuario = el.campoUsuario.value.trim();
    var clave = el.campoClave.value;
    if (!url.ok) {
      mostrarMensajeAcceso('La URL no es válida. Debe ser la dirección del script (https://script.google.com/macros/s/…/exec).');
      el.campoUrl.focus();
      return;
    }
    if (!usuario || !clave) {
      mostrarMensajeAcceso('Escribe tu usuario y contraseña.');
      return;
    }
    if (!navigator.onLine) {
      mostrarMensajeAcceso('Sin conexión. Conéctate a internet para ingresar.');
      return;
    }
    el.btnEntrar.disabled = true;
    el.btnEntrar.textContent = 'Verificando…';
    mostrarMensajeAcceso('');
    // La URL se guarda temporalmente para poder llamar; si el login falla se restaura
    var urlAnterior = leer(CLAVES.url);
    guardar(CLAVES.url, url.url);
    llamarServidor('login', { usuario: usuario, clave: clave }).then(function (r) {
      el.btnEntrar.disabled = false;
      el.btnEntrar.textContent = 'Entrar';
      if (!r.ok || typeof r.token !== 'string') {
        if (urlAnterior) guardar(CLAVES.url, urlAnterior); else borrar(CLAVES.url);
        var codigo = r.ok ? 'RESPUESTA_INVALIDA' : r.error;
        mostrarMensajeAcceso(codigo === 'RED' || codigo === 'TIEMPO'
          ? 'No se pudo conectar con el servidor. Revisa tu señal y la URL, e intenta de nuevo.'
          : mensajeDe(codigo));
        if (r.error === 'CREDENCIALES') { el.campoClave.value = ''; el.campoClave.focus(); }
        return;
      }
      // Si entra otra persona en este celular, no se muestran las lecturas del anterior
      if ((leer(CLAVES.usuario) || '').toLowerCase() !== String(r.usuario).toLowerCase()) {
        borrar(CLAVES.ultimas);
        borrar(CLAVES.reintento);
      }
      guardar(CLAVES.usuario, r.usuario);
      guardar(CLAVES.token, r.token);
      guardar(CLAVES.rol, r.rol === 'ADMIN' ? 'ADMIN' : 'USUARIO');
      el.campoClave.value = '';
      mostrarLector();
      mostrarResultado('info', 'Hola ' + r.usuario + '. Apunta la cámara al código QR del pallet.');
    });
  }

  function cerrarSesion() {
    var token = leer(CLAVES.token);
    if (token && navigator.onLine) llamarServidor('logout', { token: token });
    [CLAVES.url, CLAVES.usuario, CLAVES.token, CLAVES.rol, CLAVES.ultimas, CLAVES.reintento].forEach(borrar);
    el.observacionRapida.value = '';
    mostrarAcceso('');
  }

  /** El servidor rechazó el token: se pide ingresar de nuevo (URL y usuario quedan precargados). */
  function sesionExpirada() {
    borrar(CLAVES.token);
    borrar(CLAVES.rol);
    if (el.dlg.open) el.dlg.close();
    mostrarAcceso(MENSAJES.SESION);
  }

  // ======================================================================
  // Conexión
  // ======================================================================

  function actualizarConexion() {
    var enLinea = navigator.onLine;
    el.avisoOffline.hidden = enLinea;
    el.btnRegistrarManual.disabled = !enLinea;
    el.btnResumen.disabled = !enLinea;
    el.btnDescargar.disabled = !enLinea;
    document.body.classList.toggle('sin-conexion', !enLinea);
  }

  // ======================================================================
  // Cámara
  // ======================================================================

  function iniciarCamara() {
    if (estado.camaraActiva || el.pantallaLector.hidden) return;
    el.msgCamara.hidden = true;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      mostrarErrorCamara('Este navegador no permite usar la cámara aquí. Abre la app desde su dirección https. Puedes usar el ingreso manual.');
      return;
    }
    if (typeof window.Html5Qrcode !== 'function') {
      mostrarErrorCamara('No se pudo cargar el lector. Recarga la página.');
      return;
    }
    if (!estado.lector) {
      estado.lector = new window.Html5Qrcode('lector', {
        formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false
      });
    }
    estado.camaraActiva = true;
    el.btnCamara.textContent = 'Detener cámara';
    estado.lector.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: function (ancho, alto) {
          var lado = Math.max(150, Math.floor(Math.min(ancho, alto) * 0.7));
          return { width: lado, height: lado };
        }
      },
      alLeerQr,
      function () { /* fotogramas sin QR: se ignoran */ }
    ).then(function () {
      configurarLinterna();
    }).catch(function (err) {
      estado.camaraActiva = false;
      el.btnCamara.textContent = 'Activar cámara';
      mostrarErrorCamara(describirErrorCamara(err));
    });
  }

  function detenerCamara() {
    el.btnLinterna.hidden = true;
    estado.linterna = false;
    if (!estado.lector || !estado.camaraActiva) return Promise.resolve();
    estado.camaraActiva = false;
    el.btnCamara.textContent = 'Activar cámara';
    return estado.lector.stop().catch(function () { /* ya estaba detenida */ });
  }

  function describirErrorCamara(err) {
    var t = String(err && err.name ? err.name + ' ' + err.message : err);
    if (/NotAllowed|Permission|denied/i.test(t)) {
      return 'Permiso de cámara denegado. Actívalo en los ajustes del navegador para este sitio y toca "Activar cámara". Mientras tanto usa el ingreso manual.';
    }
    if (/NotFound|DevicesNotFound|no camera/i.test(t)) return 'No se encontró una cámara en este dispositivo. Usa el ingreso manual.';
    if (/NotReadable|TrackStart|in use/i.test(t)) return 'La cámara está en uso por otra app. Ciérrala y toca "Activar cámara".';
    if (/Overconstrained/i.test(t)) return 'No se pudo usar la cámara trasera. Toca "Activar cámara" para reintentar.';
    return 'No se pudo iniciar la cámara. Toca "Activar cámara" para reintentar o usa el ingreso manual.';
  }

  function mostrarErrorCamara(texto) {
    el.msgCamara.textContent = texto;
    el.msgCamara.hidden = false;
  }

  function configurarLinterna() {
    el.btnLinterna.hidden = true;
    try {
      var linterna = estado.lector.getRunningTrackCameraCapabilities().torchFeature();
      if (linterna.isSupported()) {
        el.btnLinterna.hidden = false;
        el.btnLinterna.setAttribute('aria-pressed', 'false');
        el.btnLinterna.textContent = 'Linterna';
      }
    } catch (e) { /* sin soporte (p. ej. iOS) */ }
  }

  function alternarLinterna() {
    try {
      var linterna = estado.lector.getRunningTrackCameraCapabilities().torchFeature();
      var nuevo = !estado.linterna;
      linterna.apply(nuevo).then(function () {
        estado.linterna = nuevo;
        el.btnLinterna.setAttribute('aria-pressed', String(nuevo));
        el.btnLinterna.textContent = nuevo ? 'Apagar linterna' : 'Linterna';
      }).catch(function () {
        mostrarResultado('error', 'No se pudo cambiar la linterna.');
      });
    } catch (e) {
      el.btnLinterna.hidden = true;
    }
  }

  function pausarLector() {
    try {
      if (estado.lector && estado.lector.getState() === window.Html5QrcodeScannerState.SCANNING) estado.lector.pause(true);
    } catch (e) { /* ignorar */ }
  }

  function reanudarLector() {
    try {
      if (estado.lector && estado.lector.getState() === window.Html5QrcodeScannerState.PAUSED) estado.lector.resume();
    } catch (e) { /* ignorar */ }
  }

  // ======================================================================
  // Lecturas
  // ======================================================================

  function alLeerQr(texto) {
    if (estado.ocupado || el.dlg.open) return;
    if (estado.esRepetida(texto)) return;
    if (!navigator.onLine) {
      retroalimentar('error');
      mostrarResultado('error', 'Sin conexión: la lectura NO se registró.');
      return;
    }
    var campos = L.parsearQr(texto);
    if (!campos.ok) {
      retroalimentar('error');
      mostrarResultado('error', MENSAJES.QR_INVALIDO);
      return;
    }
    var obs = L.normalizarObservacion(el.observacionRapida.value);
    if (obs === null) {
      mostrarResultado('error', 'La observación es demasiado larga (máximo 500 caracteres).');
      return;
    }
    registrar(campos, obs).then(function (ok) {
      if (ok) el.observacionRapida.value = '';
    });
  }

  function alEnviarManual(ev) {
    ev.preventDefault();
    var campos = L.validarCampos(el.manualPedido.value, el.manualProducto.value, el.manualPallet.value);
    if (!campos.ok) {
      retroalimentar('error');
      mostrarResultado('error', 'Completa N° pedido, código producto y N° pallet (máximo 100 caracteres cada uno).');
      return;
    }
    var obs = L.normalizarObservacion(el.manualObservacion.value);
    if (obs === null) {
      mostrarResultado('error', 'La observación es demasiado larga (máximo 500 caracteres).');
      return;
    }
    if (!navigator.onLine) {
      retroalimentar('error');
      mostrarResultado('error', 'Sin conexión: la lectura NO se registró.');
      return;
    }
    registrar(campos, obs).then(function (ok) {
      if (ok) {
        el.manualPedido.value = el.manualProducto.value = el.manualPallet.value = el.manualObservacion.value = '';
      }
    });
  }

  /**
   * Envía una lectura y maneja la respuesta (incluido el flujo de duplicado).
   * Resuelve true si quedó registrada.
   */
  function registrar(campos, observacion) {
    if (estado.ocupado) return Promise.resolve(false);
    estado.ocupado = true;
    pausarLector();
    var clave = L.claveLectura(campos);
    var pendiente = leerReintento();
    var id = pendiente && pendiente.clave === clave ? pendiente.id : L.generarUuid();
    var descripcion = campos.pedido + ' · ' + campos.producto + ' · Pallet ' + campos.pallet;
    mostrarResultado('enviando', 'Enviando… ' + descripcion);

    var datos = {
      token: leer(CLAVES.token), id: id,
      pedido: campos.pedido, producto: campos.producto, pallet: campos.pallet,
      observacion: observacion, confirmarDuplicado: false
    };

    return llamarServidor('lectura', datos).then(function (r) {
      if (!r.ok && r.error === 'DUPLICADO') {
        retroalimentar('advertencia');
        mostrarResultado('advertencia', 'Ya registrado: ' + descripcion);
        return preguntarDuplicado(r.previo, observacion).then(function (obsConfirmada) {
          if (obsConfirmada === null) {
            agregarUltima(campos, 'descartado', null, id);
            mostrarResultado('advertencia', 'No registrado (duplicado descartado): ' + descripcion);
            guardarReintento(null);
            return false;
          }
          mostrarResultado('enviando', 'Enviando… ' + descripcion);
          datos.observacion = obsConfirmada;
          datos.confirmarDuplicado = true;
          return llamarServidor('lectura', datos).then(function (r2) {
            return procesarRespuesta(r2, campos, id, descripcion, 'duplicado');
          });
        });
      }
      return procesarRespuesta(r, campos, id, descripcion, 'registrado');
    }).then(function (ok) {
      estado.ocupado = false;
      if (!el.pantallaLector.hidden) reanudarLector();
      return ok;
    });
  }

  function procesarRespuesta(r, campos, id, descripcion, estadoOk) {
    if (r.ok) {
      guardarReintento(null);
      retroalimentar('ok');
      mostrarResultado('ok', 'Registrado N° ' + r.correlativo + ': ' + descripcion +
        (r.repetido ? ' (ya estaba guardada; no se duplicó)' : ''));
      agregarUltima(campos, estadoOk, r.correlativo, id);
      return true;
    }
    if (r.error === 'SESION') {
      retroalimentar('error');
      sesionExpirada();
      return false;
    }
    // Sin respuesta clara: puede que el servidor SÍ la haya guardado.
    // Se marca "Sin confirmar" y el reintento usará el mismo ID para no duplicar.
    var incierto = r.error === 'RED' || r.error === 'TIEMPO' || r.error === 'OCUPADO' ||
      r.error === 'INTERNO' || r.error === 'RESPUESTA_INVALIDA';
    guardarReintento(incierto ? { clave: L.claveLectura(campos), id: id } : null);
    retroalimentar('error');
    mostrarResultado('error', mensajeDe(r.error));
    agregarUltima(campos, incierto ? 'sinConfirmar' : 'error', null, id);
    return false;
  }

  /** Muestra el diálogo de duplicado. Resuelve con la observación escrita o null si se descarta. */
  function preguntarDuplicado(previo, observacionInicial) {
    return new Promise(function (resolver) {
      var p = previo || {};
      el.dupTexto.textContent = 'Este pallet ya fue registrado' +
        (p.usuario ? ' por ' + p.usuario : '') + (p.fecha ? ' el ' + p.fecha : '') +
        (p.correlativo ? ' (N° ' + p.correlativo + ')' : '') + '.' +
        (p.usuario && String(p.usuario).toLowerCase() === (leer(CLAVES.usuario) || '').toLowerCase()
          ? ' Lo registraste tú: si es una lectura anterior que quedó "sin confirmar", ya está guardada y no necesitas registrarla de nuevo.'
          : '');
      el.dupObs.value = observacionInicial || '';
      el.dupError.hidden = true;

      function terminar(valor) {
        el.formDup.removeEventListener('submit', alConfirmar);
        el.dupCancelar.removeEventListener('click', alCancelar);
        el.dlg.removeEventListener('cancel', alCancelar);
        if (el.dlg.open) el.dlg.close();
        resolver(valor);
      }
      function alConfirmar(ev) {
        ev.preventDefault();
        var obs = L.normalizarObservacion(el.dupObs.value);
        if (!obs) {
          el.dupError.textContent = obs === null ? 'Máximo 500 caracteres.' : 'Escribe una observación.';
          el.dupError.hidden = false;
          el.dupObs.focus();
          return;
        }
        terminar(obs);
      }
      function alCancelar(ev) {
        if (ev) ev.preventDefault();
        terminar(null);
      }
      el.formDup.addEventListener('submit', alConfirmar);
      el.dupCancelar.addEventListener('click', alCancelar);
      el.dlg.addEventListener('cancel', alCancelar);
      el.dlg.showModal();
      el.dupObs.focus();
    });
  }

  // ---------- Últimas lecturas ----------

  function leerUltimas() {
    try {
      var lista = JSON.parse(leer(CLAVES.ultimas) || '[]');
      return Array.isArray(lista) ? lista : [];
    } catch (e) {
      return [];
    }
  }

  /** Agrega una lectura a la lista; si ya había una con el mismo ID (reintento), la reemplaza. */
  function agregarUltima(campos, estadoLectura, correlativo, id) {
    var lista = leerUltimas().filter(function (l) { return !id || l.id !== id; });
    lista.unshift({
      id: id,
      hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      pedido: campos.pedido, producto: campos.producto, pallet: campos.pallet,
      estado: estadoLectura, correlativo: correlativo
    });
    guardar(CLAVES.ultimas, JSON.stringify(lista.slice(0, MAX_ULTIMAS)));
    renderUltimas();
  }

  var TEXTO_ESTADO = {
    registrado: 'Registrado', duplicado: 'Registrado (duplicado)',
    descartado: 'No registrado', error: 'Error',
    sinConfirmar: 'Sin confirmar: reintentar'
  };

  function renderUltimas() {
    var lista = leerUltimas();
    el.listaUltimas.textContent = '';
    lista.forEach(function (l) {
      var li = document.createElement('li');
      var datos = document.createElement('span');
      datos.className = 'datos';
      datos.textContent = l.pedido + ' · ' + l.producto + ' · Pallet ' + l.pallet;
      var est = document.createElement('span');
      est.className = 'estado estado--' + l.estado;
      est.textContent = (TEXTO_ESTADO[l.estado] || l.estado) + (l.correlativo ? ' N° ' + l.correlativo : '');
      var hora = document.createElement('span');
      hora.className = 'hora';
      hora.textContent = l.hora;
      li.appendChild(datos);
      li.appendChild(est);
      li.appendChild(hora);
      el.listaUltimas.appendChild(li);
    });
    el.sinLecturas.hidden = lista.length > 0;
  }

  // ======================================================================
  // Retroalimentación: mensaje, vibración y sonido
  // ======================================================================

  function mostrarResultado(tipo, texto) {
    el.resultado.className = 'resultado' + (tipo === 'info' ? '' : ' resultado--' + tipo);
    el.resultado.textContent = texto;
  }

  var audio = null;
  function desbloquearAudio() {
    try {
      if (!audio) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audio = new Ctx();
      }
      if (audio && audio.state === 'suspended') audio.resume();
    } catch (e) { audio = null; }
  }

  function tono(frecuencia, inicio, duracion) {
    var osc = audio.createOscillator();
    var gan = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = frecuencia;
    var t = audio.currentTime + inicio;
    gan.gain.setValueAtTime(0.0001, t);
    gan.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    gan.gain.exponentialRampToValueAtTime(0.0001, t + duracion);
    osc.connect(gan);
    gan.connect(audio.destination);
    osc.start(t);
    osc.stop(t + duracion + 0.02);
  }

  function retroalimentar(tipo) {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(tipo === 'ok' ? 80 : tipo === 'advertencia' ? [80, 60, 80] : [250, 80, 250]);
      }
    } catch (e) { /* sin vibración */ }
    try {
      desbloquearAudio();
      if (!audio) return;
      if (tipo === 'ok') tono(1046, 0, 0.12);
      else if (tipo === 'advertencia') { tono(660, 0, 0.12); tono(660, 0.18, 0.12); }
      else tono(220, 0, 0.35);
    } catch (e) { /* sin sonido */ }
  }

  // ======================================================================
  // Administración
  // ======================================================================

  function mostrarMensajeAdmin(tipo, texto) {
    el.msgAdmin.className = 'mensaje mensaje--' + tipo;
    el.msgAdmin.textContent = texto;
    el.msgAdmin.hidden = !texto;
  }

  function cargarResumen() {
    el.btnResumen.disabled = true;
    mostrarMensajeAdmin('ok', '');
    llamarServidor('resumen', { token: leer(CLAVES.token) }).then(function (r) {
      el.btnResumen.disabled = !navigator.onLine;
      if (!r.ok) {
        if (r.error === 'SESION') return sesionExpirada();
        mostrarMensajeAdmin('error', mensajeDe(r.error));
        return;
      }
      el.resumen.textContent = '';
      var p = document.createElement('p');
      p.textContent = 'Hoy ' + r.fecha + ': ' + r.total + ' lectura' + (r.total === 1 ? '' : 's') + '.';
      el.resumen.appendChild(p);
      if (r.porUsuario && r.porUsuario.length) {
        var tabla = document.createElement('table');
        tabla.className = 'resumen';
        var cab = tabla.createTHead().insertRow();
        ['Usuario', 'Lecturas'].forEach(function (t) {
          var th = document.createElement('th');
          th.scope = 'col';
          th.textContent = t;
          cab.appendChild(th);
        });
        var cuerpo = tabla.createTBody();
        r.porUsuario.forEach(function (u) {
          var fila = cuerpo.insertRow();
          fila.insertCell().textContent = u.usuario;
          fila.insertCell().textContent = u.cantidad;
        });
        el.resumen.appendChild(tabla);
      }
    });
  }

  function descargarCopia() {
    el.btnDescargar.disabled = true;
    mostrarMensajeAdmin('ok', 'Preparando descarga…');
    llamarServidor('exportar', { token: leer(CLAVES.token) }).then(function (r) {
      el.btnDescargar.disabled = !navigator.onLine;
      if (!r.ok || !Array.isArray(r.filas)) {
        if (r.error === 'SESION') return sesionExpirada();
        mostrarMensajeAdmin('error', mensajeDe(r.ok ? 'RESPUESTA_INVALIDA' : r.error));
        return;
      }
      var csv = L.construirCsv(r.filas);
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var enlace = document.createElement('a');
      var hoy = new Date();
      var dos = function (n) { return String(n).padStart(2, '0'); };
      enlace.href = URL.createObjectURL(blob);
      enlace.download = 'lecturas-' + hoy.getFullYear() + '-' + dos(hoy.getMonth() + 1) + '-' + dos(hoy.getDate()) + '.csv';
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(function () { URL.revokeObjectURL(enlace.href); }, 10000);
      mostrarMensajeAdmin('ok', 'Descarga lista: ' + Math.max(r.filas.length - 1, 0) + ' lecturas.');
    });
  }

  // ======================================================================
  // Inicio
  // ======================================================================

  function iniciar() {
    el.formAcceso.addEventListener('submit', alEnviarAcceso);
    el.btnVerClave.addEventListener('click', function () {
      var ver = el.campoClave.type === 'password';
      el.campoClave.type = ver ? 'text' : 'password';
      el.btnVerClave.textContent = ver ? 'Ocultar' : 'Ver';
      el.btnVerClave.setAttribute('aria-pressed', String(ver));
    });
    el.btnSalir.addEventListener('click', function () {
      if (window.confirm('¿Cerrar sesión en este dispositivo? Tendrás que volver a ingresar la URL, el usuario y la contraseña.')) cerrarSesion();
    });
    el.btnCamara.addEventListener('click', function () {
      desbloquearAudio();
      if (estado.camaraActiva) detenerCamara(); else iniciarCamara();
    });
    el.btnLinterna.addEventListener('click', alternarLinterna);
    el.formManual.addEventListener('submit', alEnviarManual);
    el.btnResumen.addEventListener('click', cargarResumen);
    el.btnDescargar.addEventListener('click', descargarCopia);
    // El primer toque en la pantalla habilita el sonido (requisito de los navegadores)
    document.addEventListener('pointerdown', desbloquearAudio, { once: true });

    window.addEventListener('online', actualizarConexion);
    window.addEventListener('offline', actualizarConexion);
    // Apaga la cámara en segundo plano y la reanuda al volver
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) detenerCamara();
      else if (!el.pantallaLector.hidden) iniciarCamara();
    });

    actualizarConexion();
    if (haySesion()) mostrarLector(); else mostrarAcceso('');

    if ('serviceWorker' in navigator) {
      var habiaControlador = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin service worker */ });
      // Al publicarse una versión nueva, se recarga una vez para usarla
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (habiaControlador && !estado.ocupado && !el.dlg.open) window.location.reload();
      });
    }
  }

  iniciar();
})();
