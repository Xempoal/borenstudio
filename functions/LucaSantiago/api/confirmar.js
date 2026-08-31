import { json, error, leerJson, origenPermitido } from "../../_lib/http.js";

const PREFIJO = "luca:rsvp:";
const MAX_NOMBRE = 100;
const MAX_INTENTOS_MINUTO = 5;

function nombreLimpio(valor) {
  return String(valor ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function huella(texto) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

async function limitar(env, request) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const minuto = Math.floor(Date.now() / 60000);
  const clave = `luca:rsvp-rate:${await huella(ip)}:${minuto}`;
  const intentos = (Number(await env.ESTADO.get(clave)) || 0) + 1;
  await env.ESTADO.put(clave, String(intentos), { expirationTtl: 120 });
  return intentos <= MAX_INTENTOS_MINUTO;
}

export async function onRequestPost({ request, env }) {
  if (!origenPermitido(request)) return error("Origen no permitido.", 403);
  if (!env.ESTADO) return error("Las confirmaciones no están disponibles por el momento.", 503);

  const largo = Number(request.headers.get("content-length") || 0);
  if (largo > 2048) return error("La solicitud es demasiado grande.", 413);
  if (!(await limitar(env, request))) {
    return error("Demasiados intentos. Espera un minuto y vuelve a intentar.", 429);
  }

  const cuerpo = (await leerJson(request)) || {};
  if (cuerpo.website) return json({ ok: true }); // campo trampa para bots

  const nombre = nombreLimpio(cuerpo.nombre);
  if (nombre.length < 3) return error("Escribe tu nombre completo.");
  if (nombre.length > MAX_NOMBRE) return error(`El nombre no puede superar ${MAX_NOMBRE} caracteres.`);

  const id = await huella(nombre.toLocaleLowerCase("es-MX"));
  const clave = `${PREFIJO}${id}`;
  const ahora = new Date().toISOString();
  const anterior = await env.ESTADO.get(clave, "json");

  await env.ESTADO.put(
    clave,
    JSON.stringify({
      id,
      nombre,
      confirmadoEn: anterior?.confirmadoEn || ahora,
      actualizadoEn: ahora,
    })
  );

  return json({ ok: true, nombre, duplicado: Boolean(anterior) }, anterior ? 200 : 201);
}

export function onRequestGet() {
  return error("Método no permitido.", 405, { allow: "POST" });
}
