/**
 * POST /api/firmar
 *
 * Entrada:  { negocio, archivos: [{ nombre, tamano, tipo }], carpeta? }
 * Salida:   { ok, carpeta, prefijo, expiraEn, archivos: [{ indice, nombre, clave, url }] }
 *
 * `carpeta` es opcional y solo se usa para REINTENTAR una tanda que ya empezo,
 * asi los archivos que fallaron caen en la misma carpeta que sus hermanos.
 */

import { json, error, origenPermitido, leerJson } from "../_lib/http.js";
import {
  slugNegocio,
  sanitizarArchivo,
  carpetaTimestamp,
  prefijoValido,
} from "../_lib/slug.js";
import { crearCliente, firmarPut, credencialesFaltantes } from "../_lib/firma.js";
import {
  apartarCuota,
  devolverCuota,
  leerCuota,
  fechaLegible,
  TOPE_TANDA,
  GB,
} from "../_lib/cuota.js";

// Limites de la tanda. Para cambiarlos, ver README-carga.md.
export const MAX_ARCHIVOS = 100;
export const MAX_BYTES_ARCHIVO = 2 * GB; // 2 GB por archivo
const VIGENCIA_SEGUNDOS = 3600; // 1 hora

function peso(bytes) {
  const u = ["B", "KB", "MB", "GB"];
  const i = bytes <= 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export async function onRequestPost({ request, env }) {
  if (!origenPermitido(request)) return error("Origen no permitido.", 403);

  const faltan = credencialesFaltantes(env);
  if (faltan.length) {
    return error(
      "El portal de carga aun no esta configurado. Avisale a Boren Studio.",
      503,
      { faltan }
    );
  }

  const cuerpo = await leerJson(request);
  if (!cuerpo) return error("Peticion invalida.");

  // --- Nombre del negocio ---
  const negocio = String(cuerpo.negocio || "").trim();
  if (negocio.length < 2 || negocio.length > 60) {
    return error("El nombre del negocio debe tener entre 2 y 60 caracteres.");
  }

  // --- Lista de archivos ---
  const archivos = Array.isArray(cuerpo.archivos) ? cuerpo.archivos : null;
  if (!archivos || archivos.length === 0) {
    return error("No mandaste ningun archivo.");
  }
  if (archivos.length > MAX_ARCHIVOS) {
    return error(`Maximo ${MAX_ARCHIVOS} archivos por envio.`);
  }

  let totalTanda = 0;
  for (const a of archivos) {
    if (!a || typeof a !== "object") return error("Lista de archivos invalida.");
    const tamano = Number(a.tamano);
    if (!Number.isFinite(tamano) || tamano < 0) {
      return error("Lista de archivos invalida.");
    }
    if (tamano > MAX_BYTES_ARCHIVO) {
      return error(
        `"${String(a.nombre || "archivo").slice(0, 60)}" pesa mas de 2 GB.`,
        413
      );
    }
    totalTanda += tamano;
  }

  // --- Tope por carga: 2 GB en total ---
  if (totalTanda > TOPE_TANDA) {
    return error(
      `Esta carga pesa ${peso(totalTanda)} y el maximo por envio es 2 GB. ` +
        `Quita algunos archivos y manda el resto en un segundo envio.`,
      413,
      { limite: "tanda", totalTanda, topeTanda: TOPE_TANDA }
    );
  }

  // --- Cuota mensual: 9.99 GB por ventana de 32 dias ---
  const apartado = await apartarCuota(env, totalTanda);
  if (!apartado.ok) {
    const c = apartado.cuota;
    return error(
      c.disponible <= 0
        ? `Se alcanzo el limite de almacenamiento de este periodo. Se libera el ${fechaLegible(c.fin)}.`
        : `Solo queda espacio para ${peso(c.disponible)} en este periodo y esta carga pesa ${peso(totalTanda)}. Se libera el ${fechaLegible(c.fin)}.`,
      507,
      {
        limite: "mensual",
        disponible: c.disponible,
        seLiberaEl: c.fin,
        totalTanda,
      }
    );
  }

  // A partir de aqui la cuota ya esta apartada: si algo falla, se devuelve.
  try {
    // --- Prefijo de la tanda ---
    const slug = slugNegocio(negocio);
    let prefijo;
    if (cuerpo.carpeta) {
      // Reintento: reusamos la carpeta, pero exigimos que sea de ESTE negocio.
      if (!prefijoValido(cuerpo.carpeta) || !cuerpo.carpeta.startsWith(`${slug}/`)) {
        throw new Error("Carpeta invalida.");
      }
      prefijo = cuerpo.carpeta;
    } else {
      // El timestamp se calcula una sola vez, aqui, para toda la tanda.
      prefijo = `${slug}/${carpetaTimestamp()}/`;
    }

    // --- Firma ---
    const cliente = crearCliente(env);
    const vistos = new Set();

    const firmados = await Promise.all(
      archivos.map(async (a, indice) => {
        let nombre = sanitizarArchivo(a.nombre);

        // Dos "IMG_0001.jpg" en la misma tanda no deben pisarse.
        if (vistos.has(nombre)) {
          const punto = nombre.lastIndexOf(".");
          const cuerpoN = punto > 0 ? nombre.slice(0, punto) : nombre;
          const ext = punto > 0 ? nombre.slice(punto) : "";
          nombre = `${cuerpoN}-${indice + 1}${ext}`;
        }
        vistos.add(nombre);

        const clave = prefijo + nombre;
        return {
          indice,
          nombre,
          clave,
          url: await firmarPut(cliente, env, clave, VIGENCIA_SEGUNDOS),
        };
      })
    );

    return json({
      ok: true,
      negocio,
      carpeta: prefijo,
      prefijo,
      expiraEn: VIGENCIA_SEGUNDOS,
      archivos: firmados,
      cuota: {
        usado: apartado.cuota.usado,
        disponible: apartado.cuota.disponible,
        seLiberaEl: apartado.cuota.fin,
      },
    });
  } catch (e) {
    // No se firmo nada: los GB apartados no se usaron, se regresan.
    await devolverCuota(env, totalTanda);
    return error(e.message === "Carpeta invalida." ? e.message : "No se pudieron preparar las subidas.");
  }
}

/** GET /api/firmar -> cuanto espacio queda, para pintarlo en el portal. */
export async function onRequestGet({ env }) {
  const c = await leerCuota(env);
  return json({
    ok: true,
    disponible: c.disponible,
    usado: c.usado,
    seLiberaEl: c.fin,
    topeTanda: TOPE_TANDA,
  });
}
