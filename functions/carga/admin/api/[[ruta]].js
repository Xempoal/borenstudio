/**
 * API del panel de administrador.  /carga/admin/api/*
 *
 *   POST /carga/admin/api/entrar             -> valida el PIN y abre sesion
 *   POST /carga/admin/api/salir              -> cierra sesion
 *   GET  /carga/admin/api/sesion             -> ¿hay sesion? ¿hay bloqueo?
 *   GET  /carga/admin/api/carpetas           -> tandas, mas recientes primero
 *   GET  /carga/admin/api/carpeta?p=<pref>   -> archivos de una tanda
 *   GET  /carga/admin/api/zip?p=<pref>       -> la carpeta entera en un .zip
 *
 * Todo menos `entrar` y `sesion` exige la cookie de sesion firmada.
 */

import { json, error, leerJson } from "../../../_lib/http.js";
import {
  tieneSesion,
  intentarEntrar,
  bloqueoRestante,
  cookieDeSalida,
  faltaConfiguracion,
  FALLOS_DISPOSITIVO,
  HORAS_BLOQUEO,
} from "../../../_lib/panel.js";
import { prefijoValido } from "../../../_lib/slug.js";
import { crearCliente, firmarGet, credencialesFaltantes } from "../../../_lib/firma.js";
import { crearZip } from "../../../_lib/zip.js";
import { leerCuota, TOPE_MENSUAL } from "../../../_lib/cuota.js";

const TOPE_OBJETOS = 10000;
const VIGENCIA_DESCARGA = 3600; // 1 h

const RE_IMAGEN = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp|tiff?)$/i;
const RE_VIDEO = /\.(mp4|mov|m4v|webm|avi|mkv|3gp|hevc)$/i;

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

async function listarTodo(bucket, prefix) {
  const objetos = [];
  let cursor;
  let truncado = false;

  do {
    const r = await bucket.list({ prefix, cursor, limit: 1000 });
    objetos.push(...r.objects);
    cursor = r.truncated ? r.cursor : undefined;
    if (objetos.length >= TOPE_OBJETOS && cursor) {
      truncado = true;
      break;
    }
  } while (cursor);

  return { objetos, truncado };
}

/** "hamburguesas-tony" -> "Hamburguesas Tony" (solo para mostrar). */
function nombreLegible(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** "2026-08-14_1432" -> "14/08/2026 14:32" */
function fechaLegible(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/.exec(ts);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : ts;
}

function tipoDe(nombre) {
  if (RE_IMAGEN.test(nombre)) return "imagen";
  if (RE_VIDEO.test(nombre)) return "video";
  return "otro";
}

/* ------------------------------------------------------------------ */
/* Rutas con datos (exigen sesion)                                     */
/* ------------------------------------------------------------------ */

async function carpetas(env) {
  const { objetos, truncado } = await listarTodo(env.CARGAS, "");
  const mapa = new Map();

  for (const o of objetos) {
    const partes = o.key.split("/");
    if (partes.length < 3) continue; // clave suelta, no es una tanda nuestra
    const [negocio, ts] = partes;
    const prefijo = `${negocio}/${ts}/`;

    let c = mapa.get(prefijo);
    if (!c) {
      c = {
        prefijo,
        slug: negocio,
        negocio: nombreLegible(negocio),
        ts,
        fecha: fechaLegible(ts),
        cantidad: 0,
        bytes: 0,
        subida: o.uploaded,
      };
      mapa.set(prefijo, c);
    }
    c.cantidad++;
    c.bytes += o.size;
    if (o.uploaded < c.subida) c.subida = o.uploaded;
  }

  const lista = [...mapa.values()].sort((a, b) =>
    a.ts === b.ts ? a.slug.localeCompare(b.slug) : b.ts.localeCompare(a.ts)
  );

  const cuota = await leerCuota(env);

  return json({
    ok: true,
    truncado,
    carpetas: lista,
    cuota: {
      usado: cuota.usado,
      disponible: cuota.disponible,
      tope: TOPE_MENSUAL,
      seLiberaEl: cuota.fin,
      dias: cuota.dias,
    },
  });
}

async function carpeta(env, prefijo) {
  const faltan = credencialesFaltantes(env);
  if (faltan.length) {
    return error("Faltan las llaves S3 de R2 en los secrets.", 503, { faltan });
  }

  const { objetos } = await listarTodo(env.CARGAS, prefijo);
  if (objetos.length === 0) {
    return error("Esa carpeta ya no existe (o la borro la regla de 10 dias).", 404);
  }

  const cliente = crearCliente(env);
  const [slug, ts] = prefijo.split("/");

  const archivos = await Promise.all(
    objetos.map(async (o) => {
      const nombre = o.key.slice(prefijo.length);
      const tipo = tipoDe(nombre);
      return {
        nombre,
        clave: o.key,
        bytes: o.size,
        tipo,
        subido: o.uploaded,
        descarga: await firmarGet(cliente, env, o.key, VIGENCIA_DESCARGA, nombre),
        // Sin content-disposition: sirve para el <img> de la miniatura.
        vista:
          tipo === "imagen"
            ? await firmarGet(cliente, env, o.key, VIGENCIA_DESCARGA)
            : null,
      };
    })
  );

  archivos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));

  return json({
    ok: true,
    prefijo,
    negocio: nombreLegible(slug),
    fecha: fechaLegible(ts),
    cantidad: archivos.length,
    bytes: archivos.reduce((s, a) => s + a.bytes, 0),
    archivos,
  });
}

async function zip(env, prefijo) {
  const { objetos } = await listarTodo(env.CARGAS, prefijo);
  if (objetos.length === 0) return error("Esa carpeta ya no existe.", 404);

  const [slug, ts] = prefijo.split("/");
  const entradas = objetos.map((o) => ({
    clave: o.key,
    nombre: `${slug}_${ts}/${o.key.slice(prefijo.length)}`,
  }));

  const cuerpo = crearZip(entradas, async (entrada) => {
    const obj = await env.CARGAS.get(entrada.clave);
    return obj ? obj.body : null;
  });

  return new Response(cuerpo, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${slug}_${ts}.zip"`,
      "cache-control": "no-store",
      // Sin content-length: el tamano solo se sabe al terminar de escribirlo.
      "x-content-type-options": "nosniff",
    },
  });
}

/* ------------------------------------------------------------------ */
/* Entrada y salida                                                    */
/* ------------------------------------------------------------------ */

export async function onRequestPost({ request, env, params }) {
  const ruta = Array.isArray(params.ruta) ? params.ruta.join("/") : params.ruta || "";

  if (ruta === "salir") {
    return json({ ok: true }, 200, { "set-cookie": cookieDeSalida() });
  }

  if (ruta !== "entrar") return error("Ruta no encontrada.", 404);

  const faltan = faltaConfiguracion(env);
  if (faltan.length) {
    return error("El panel aun no esta configurado.", 503, { faltan });
  }

  const cuerpo = (await leerJson(request)) || {};
  const pin = String(cuerpo.pin ?? "");

  const r = await intentarEntrar(request, env, pin);

  if (r.ok) {
    return json({ ok: true }, 200, { "set-cookie": r.cookie });
  }

  if (r.motivo === "bloqueado" || r.bloqueadoMs > 0) {
    const minutos = Math.ceil((r.bloqueadoMs || 0) / 60000);
    return error(
      `Demasiados intentos. Vuelve a intentar en ${minutos >= 60 ? `${Math.ceil(minutos / 60)} h` : `${minutos} min`}.`,
      429,
      { bloqueadoMs: r.bloqueadoMs, horasBloqueo: HORAS_BLOQUEO }
    );
  }

  return error(
    r.restantes === 1
      ? "PIN incorrecto. Te queda 1 intento."
      : `PIN incorrecto. Te quedan ${r.restantes} intentos.`,
    401,
    { restantes: r.restantes, maxIntentos: FALLOS_DISPOSITIVO }
  );
}

export async function onRequestGet({ request, env, params }) {
  const ruta = Array.isArray(params.ruta) ? params.ruta.join("/") : params.ruta || "";
  const url = new URL(request.url);

  const abierta = await tieneSesion(request, env);

  // Unica ruta que responde sin sesion: para que la pantalla del PIN sepa
  // si ya hay sesion abierta o si el dispositivo esta bloqueado.
  if (ruta === "sesion") {
    const espera = abierta ? 0 : await bloqueoRestante(env, request);
    return json({
      ok: true,
      sesion: abierta,
      bloqueadoMs: espera,
      configurado: faltaConfiguracion(env).length === 0,
    });
  }

  if (!abierta) return error("Necesitas entrar con el PIN.", 401);

  if (!env.CARGAS) {
    return error("Falta el binding R2 'CARGAS' en el proyecto de Pages.", 503);
  }

  if (ruta === "carpetas") return carpetas(env);

  if (ruta === "carpeta" || ruta === "zip") {
    const prefijo = url.searchParams.get("p") || "";
    if (!prefijoValido(prefijo)) return error("Prefijo invalido.", 400);
    return ruta === "zip" ? zip(env, prefijo) : carpeta(env, prefijo);
  }

  return error("Ruta no encontrada.", 404);
}
