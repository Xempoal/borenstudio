/**
 * Cuota mensual de subida.
 *
 * Tope de 9.99 GB por periodo. El periodo corre del **día 15 de un mes al 15
 * del siguiente** y se renueva solo: al consultarlo, si el 15 ya pasó, el
 * contador arranca de cero sin importar cuánto se haya subido antes.
 * No hay cron ni tarea programada; la ventana se calcula al vuelo.
 *
 * Los GB se descuentan al FIRMAR, no al terminar la subida. Es la única forma
 * de que nadie se pase: si esperáramos a que los archivos lleguen, veinte
 * subidas al mismo tiempo rebasarían el límite antes de poder bloquear
 * ninguna. El costo es que una subida abandonada deja sus GB apartados hasta
 * que el periodo se renueve.
 *
 * Por qué KV y no las claves de R2: los objetos se borran a los 10 días, así
 * que el bucket no puede recordar cuánto se subió en un mes.
 */

const CLAVE = "cuota";

export const GB = 1024 * 1024 * 1024;
export const TOPE_MENSUAL = Math.floor(9.99 * GB); // 9.99 GB
export const TOPE_TANDA = 2 * GB; // 2 GB por envío
export const DIA_RENOVACION = 15;

/**
 * México ya no cambia de horario: Ciudad de México es UTC-6 todo el año
 * (se abolió el horario de verano en 2022). Por eso las 00:00 locales son
 * siempre las 06:00 UTC y podemos calcularlo sin tabla de zonas horarias.
 */
const OFFSET_MX_HORAS = 6;

/** Año, mes (1-12) y día en Ciudad de México. */
function hoyEnMexico(fecha) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(fecha)
      .map((x) => [x.type, Number(x.value)])
  );
  return { anio: p.year, mes: p.month, dia: p.day };
}

/** Día 15 más reciente, a las 00:00 de Ciudad de México. */
export function inicioPeriodo(fecha = new Date()) {
  const { anio, mes, dia } = hoyEnMexico(fecha);
  let a = anio;
  let m = mes;

  // Antes del 15, el periodo vigente empezó el 15 del mes pasado.
  if (dia < DIA_RENOVACION) {
    m -= 1;
    if (m === 0) {
      m = 12;
      a -= 1;
    }
  }

  return Date.UTC(a, m - 1, DIA_RENOVACION, OFFSET_MX_HORAS, 0, 0, 0);
}

/** El siguiente día 15. */
export function finPeriodo(inicio) {
  const d = new Date(inicio);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    DIA_RENOVACION,
    OFFSET_MX_HORAS,
    0,
    0,
    0
  );
}

/** Días completos que faltan para la renovación (mínimo 0). */
export function diasRestantes(fin, ahora = Date.now()) {
  return Math.max(0, Math.ceil((fin - ahora) / 86400000));
}

/**
 * Estado vigente de la cuota, ya renovado si el periodo cambió.
 * @returns {Promise<{inicio:number, fin:number, usado:number, disponible:number, dias:number}>}
 */
export async function leerCuota(env) {
  let estado = null;
  try {
    estado = await env.ESTADO.get(CLAVE, "json");
  } catch {
    estado = null;
  }

  const inicio = inicioPeriodo();
  const fin = finPeriodo(inicio);

  // Si lo guardado es de un periodo anterior, el contador vuelve a cero.
  const usado = Number(estado?.inicio) === inicio ? Number(estado?.usado) || 0 : 0;

  return {
    inicio,
    fin,
    usado,
    disponible: Math.max(0, TOPE_MENSUAL - usado),
    dias: diasRestantes(fin),
  };
}

/**
 * Aparta `bytes` de la cuota si caben.
 * @returns {Promise<{ok:boolean, cuota:object}>}
 */
export async function apartarCuota(env, bytes) {
  const cuota = await leerCuota(env);
  if (bytes > cuota.disponible) return { ok: false, cuota };

  const usado = cuota.usado + bytes;
  await env.ESTADO.put(CLAVE, JSON.stringify({ inicio: cuota.inicio, usado }));

  return {
    ok: true,
    cuota: { ...cuota, usado, disponible: Math.max(0, TOPE_MENSUAL - usado) },
  };
}

/** Devuelve bytes apartados cuando la firma falla después de haberlos tomado. */
export async function devolverCuota(env, bytes) {
  const cuota = await leerCuota(env);
  const usado = Math.max(0, cuota.usado - bytes);
  await env.ESTADO.put(CLAVE, JSON.stringify({ inicio: cuota.inicio, usado }));
}

/** "15 de septiembre" */
export function fechaLegible(ms) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "long",
  }).format(new Date(ms));
}
