/**
 * Candado del panel: PIN fijo + sesion firmada + bloqueo por intentos.
 *
 * Reemplaza a Cloudflare Access por peticion expresa: se queria entrar solo
 * con un PIN, sin cuenta ni correo de por medio.
 *
 * Como se defiende un PIN de 6 digitos (un millon de combinaciones):
 *
 *  - Por dispositivo: 2 fallos -> 3 horas bloqueado. Es el limite que se ve.
 *  - Global: 20 fallos -> 3 horas bloqueado para todos. Sin esto, alguien
 *    que rote direcciones IP tendria intentos infinitos y el PIN caeria en
 *    dias. Con el tope, son 20 intentos cada 3 h: ~160 al dia, o sea siglos.
 *  - El tope por dispositivo va primero para que un curioso que falle dos
 *    veces se bloquee a si mismo y no deje al dueno afuera.
 *  - La comparacion del PIN es de tiempo constante: comparar con === filtra
 *    informacion por el tiempo que tarda en fallar.
 *
 * La sesion no se guarda en ningun lado: es un token firmado con HMAC que
 * lleva su propia fecha de expiracion. Sin estado que sincronizar.
 */

const COOKIE = "panel_sesion";
const HORAS_SESION = 24;

export const FALLOS_DISPOSITIVO = 2;
export const FALLOS_GLOBALES = 20;
export const HORAS_BLOQUEO = 3;

const codificador = new TextEncoder();

/* ------------------------------------------------------------------ */
/* Firma de la sesion                                                   */
/* ------------------------------------------------------------------ */

function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function desdeB64url(texto) {
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function llave(env) {
  return crypto.subtle.importKey(
    "raw",
    codificador.encode(env.PANEL_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function firmarSesion(env, expira) {
  const carga = b64url(codificador.encode(JSON.stringify({ exp: expira })));
  const firma = await crypto.subtle.sign("HMAC", await llave(env), codificador.encode(carga));
  return `${carga}.${b64url(new Uint8Array(firma))}`;
}

async function sesionValida(env, token) {
  if (!token || !token.includes(".")) return false;
  const [carga, firma] = token.split(".");

  let ok;
  try {
    // verify() compara en tiempo constante.
    ok = await crypto.subtle.verify(
      "HMAC",
      await llave(env),
      desdeB64url(firma),
      codificador.encode(carga)
    );
  } catch {
    return false;
  }
  if (!ok) return false;

  try {
    const { exp } = JSON.parse(new TextDecoder().decode(desdeB64url(carga)));
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Bloqueos                                                             */
/* ------------------------------------------------------------------ */

function ipDe(request) {
  return request.headers.get("CF-Connecting-IP") || "desconocida";
}

/** @returns {Promise<number>} milisegundos que faltan, o 0 si no hay bloqueo. */
export async function bloqueoRestante(env, request) {
  const ip = ipDe(request);
  const [propio, global] = await Promise.all([
    env.ESTADO.get(`bloqueo:${ip}`),
    env.ESTADO.get("bloqueo:global"),
  ]);

  const hasta = Math.max(Number(propio) || 0, Number(global) || 0);
  return Math.max(0, hasta - Date.now());
}

/** Suma un fallo y bloquea si toca. @returns {Promise<{restantes:number, bloqueadoMs:number}>} */
async function registrarFallo(env, request) {
  const ip = ipDe(request);
  const ventana = HORAS_BLOQUEO * 3600;

  const [fPropio, fGlobal] = await Promise.all([
    env.ESTADO.get(`fallos:${ip}`),
    env.ESTADO.get("fallos:global"),
  ]);

  const propios = (Number(fPropio) || 0) + 1;
  const globales = (Number(fGlobal) || 0) + 1;

  const tareas = [
    env.ESTADO.put(`fallos:${ip}`, String(propios), { expirationTtl: ventana }),
    env.ESTADO.put("fallos:global", String(globales), { expirationTtl: ventana }),
  ];

  let bloqueadoMs = 0;
  const hasta = Date.now() + HORAS_BLOQUEO * 3600 * 1000;

  if (propios >= FALLOS_DISPOSITIVO) {
    tareas.push(env.ESTADO.put(`bloqueo:${ip}`, String(hasta), { expirationTtl: ventana }));
    bloqueadoMs = HORAS_BLOQUEO * 3600 * 1000;
  }
  if (globales >= FALLOS_GLOBALES) {
    tareas.push(env.ESTADO.put("bloqueo:global", String(hasta), { expirationTtl: ventana }));
    bloqueadoMs = HORAS_BLOQUEO * 3600 * 1000;
  }

  await Promise.all(tareas);
  return { restantes: Math.max(0, FALLOS_DISPOSITIVO - propios), bloqueadoMs };
}

async function limpiarFallos(env, request) {
  const ip = ipDe(request);
  await Promise.all([env.ESTADO.delete(`fallos:${ip}`), env.ESTADO.delete(`bloqueo:${ip}`)]);
}

/* ------------------------------------------------------------------ */
/* API publica                                                          */
/* ------------------------------------------------------------------ */

/** Compara sin filtrar informacion por el tiempo que tarda. */
function igualEnTiempoConstante(a, b) {
  const x = codificador.encode(String(a));
  const y = codificador.encode(String(b));
  // Longitudes distintas: seguimos comparando para no delatar el largo.
  let dif = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) dif |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return dif === 0;
}

export function faltaConfiguracion(env) {
  return ["PANEL_PIN", "PANEL_SESSION_SECRET"].filter((k) => !env[k]);
}

/** ¿Trae una sesion valida? */
export async function tieneSesion(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];
  return sesionValida(env, token);
}

/**
 * Valida el PIN. Devuelve la cabecera Set-Cookie si acierta.
 * @returns {Promise<{ok:true, cookie:string} | {ok:false, motivo:string, bloqueadoMs:number, restantes:number}>}
 */
export async function intentarEntrar(request, env, pin) {
  const espera = await bloqueoRestante(env, request);
  if (espera > 0) {
    return { ok: false, motivo: "bloqueado", bloqueadoMs: espera, restantes: 0 };
  }

  if (!igualEnTiempoConstante(pin, env.PANEL_PIN)) {
    const { restantes, bloqueadoMs } = await registrarFallo(env, request);
    return { ok: false, motivo: "incorrecto", bloqueadoMs, restantes };
  }

  await limpiarFallos(env, request);

  const expira = Date.now() + HORAS_SESION * 3600 * 1000;
  const token = await firmarSesion(env, expira);

  return {
    ok: true,
    cookie:
      `${COOKIE}=${token}; Path=/carga/admin; Max-Age=${HORAS_SESION * 3600}; ` +
      `HttpOnly; Secure; SameSite=Strict`,
  };
}

export function cookieDeSalida() {
  return `${COOKIE}=; Path=/carga/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
