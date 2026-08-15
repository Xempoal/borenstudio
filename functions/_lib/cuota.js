/**
 * Cuota mensual de subida.
 *
 * Tope de 9.99 GB por ventana de 32 dias. La ventana arranca el 14 de agosto
 * de 2026 y se renueva sola: si al consultar ya pasaron 32 dias desde el
 * inicio, el contador vuelve a cero sin importar cuanto se haya subido.
 *
 * Los GB se descuentan al FIRMAR, no al terminar la subida. Es la unica
 * forma de que nadie se pase: si esperaramos a que los archivos lleguen,
 * veinte subidas al mismo tiempo rebasarian el limite antes de poder
 * bloquear ninguna. El costo es que una subida abandonada deja sus GB
 * apartados hasta que la ventana se reinicie.
 *
 * Por que KV y no las claves de R2: los objetos se borran a los 10 dias, asi
 * que el bucket no puede recordar cuanto se subio en una ventana de 32.
 */

const CLAVE = "cuota";

export const GB = 1024 * 1024 * 1024;
export const TOPE_MENSUAL = Math.floor(9.99 * GB); // 9.99 GB
export const TOPE_TANDA = 2 * GB; // 2 GB por carga
export const DIAS_VENTANA = 32;

// Primera ventana: 14 de agosto de 2026, 00:00 en Ciudad de Mexico (UTC-6).
const INICIO_PRIMERA_VENTANA = Date.parse("2026-08-14T06:00:00Z");

const MS_VENTANA = DIAS_VENTANA * 24 * 3600 * 1000;

/**
 * Estado vigente de la cuota, ya renovado si la ventana caduco.
 * @returns {Promise<{inicio:number, fin:number, usado:number, disponible:number}>}
 */
export async function leerCuota(env) {
  let estado = null;
  try {
    estado = await env.ESTADO.get(CLAVE, "json");
  } catch {
    estado = null;
  }

  let inicio = Number(estado?.inicio) || INICIO_PRIMERA_VENTANA;
  let usado = Number(estado?.usado) || 0;

  // Si caducó, avanzamos en saltos de 32 dias hasta la ventana actual.
  const ahora = Date.now();
  if (ahora >= inicio + MS_VENTANA) {
    const saltos = Math.floor((ahora - inicio) / MS_VENTANA);
    inicio = inicio + saltos * MS_VENTANA;
    usado = 0;
  }

  return {
    inicio,
    fin: inicio + MS_VENTANA,
    usado,
    disponible: Math.max(0, TOPE_MENSUAL - usado),
  };
}

/**
 * Aparta `bytes` de la cuota si caben.
 * @returns {Promise<{ok:true, cuota:object} | {ok:false, cuota:object}>}
 */
export async function apartarCuota(env, bytes) {
  const cuota = await leerCuota(env);

  if (bytes > cuota.disponible) {
    return { ok: false, cuota };
  }

  const usado = cuota.usado + bytes;
  await env.ESTADO.put(
    CLAVE,
    JSON.stringify({ inicio: cuota.inicio, usado })
  );

  return {
    ok: true,
    cuota: { ...cuota, usado, disponible: Math.max(0, TOPE_MENSUAL - usado) },
  };
}

/** Devuelve bytes apartados cuando la firma falla despues de haberlos tomado. */
export async function devolverCuota(env, bytes) {
  const cuota = await leerCuota(env);
  const usado = Math.max(0, cuota.usado - bytes);
  await env.ESTADO.put(CLAVE, JSON.stringify({ inicio: cuota.inicio, usado }));
}

/** "14 de septiembre" — para decirle al cliente cuando se libera el espacio. */
export function fechaLegible(ms) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "long",
  }).format(new Date(ms));
}
