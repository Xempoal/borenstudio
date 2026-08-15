/**
 * API del panel de administrador.  /carga/admin/api/*
 *
 *   GET  /carga/admin/api/carpetas            -> tandas, mas recientes primero
 *   GET  /carga/admin/api/carpeta?p=<prefijo> -> archivos de una tanda
 *   GET  /carga/admin/api/zip?p=<prefijo>     -> la carpeta entera en un .zip
 *
 * Toda peticion pasa por la verificacion del JWT de Cloudflare Access. La
 * politica de Access cubre el dominio publico; esto cubre <proyecto>.pages.dev.
 */

import { json, error } from "../../../_lib/http.js";
import { verificarAcceso } from "../../../_lib/access.js";
import { prefijoValido } from "../../../_lib/slug.js";
import { crearCliente, firmarGet, credencialesFaltantes } from "../../../_lib/firma.js";
import { crearZip } from "../../../_lib/zip.js";

const TOPE_OBJETOS = 10000;
const VIGENCIA_DESCARGA = 3600; // 1 h

const RE_IMAGEN = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp|tiff?)$/i;
const RE_VIDEO = /\.(mp4|mov|m4v|webm|avi|mkv|3gp|hevc)$/i;

/** Lista completa bajo un prefijo, paginando el cursor de R2. */
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

/** Agrupa todos los objetos del bucket por tanda (negocio/timestamp/). */
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

  // El timestamp del prefijo ordena bien como texto: mas reciente primero.
  const lista = [...mapa.values()].sort((a, b) =>
    a.ts === b.ts ? a.slug.localeCompare(b.slug) : b.ts.localeCompare(a.ts)
  );

  return json({ ok: true, truncado, carpetas: lista });
}

/** Archivos de una tanda, con URL de descarga y de vista previa. */
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

/** La carpeta entera como un .zip que se va armando mientras se descarga. */
async function zip(env, prefijo) {
  const { objetos } = await listarTodo(env.CARGAS, prefijo);
  if (objetos.length === 0) {
    return error("Esa carpeta ya no existe.", 404);
  }

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

export async function onRequestGet({ request, env, params }) {
  const sesion = await verificarAcceso(request, env);
  if (!sesion.ok) return error(sesion.motivo, sesion.estado);

  if (!env.CARGAS) {
    return error("Falta el binding R2 'CARGAS' en el proyecto de Pages.", 503);
  }

  const ruta = Array.isArray(params.ruta) ? params.ruta.join("/") : params.ruta || "";
  const url = new URL(request.url);

  if (ruta === "carpetas") return carpetas(env);

  if (ruta === "carpeta" || ruta === "zip") {
    const prefijo = url.searchParams.get("p") || "";
    if (!prefijoValido(prefijo)) return error("Prefijo invalido.", 400);
    return ruta === "zip" ? zip(env, prefijo) : carpeta(env, prefijo);
  }

  if (ruta === "sesion") return json({ ok: true, email: sesion.email });

  return error("Ruta no encontrada.", 404);
}
