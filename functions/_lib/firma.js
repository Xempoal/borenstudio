/**
 * Firma de URLs prefirmadas (SigV4) contra el endpoint S3 de R2.
 *
 * El navegador sube DIRECTO a R2 con estas URLs. Los bytes nunca pasan por la
 * Function: el limite de 100 MB de body de un Worker haria explotar cualquier
 * video de celular en calidad original.
 */

// Copia integrada al repo, no el paquete de npm: Cloudflare no corre
// `npm install` en este proyecto. Ver el encabezado de aws4fetch.js.
import { AwsClient } from "./aws4fetch.js";

export const BUCKET = "cargas-clientes";

/** Faltan secrets -> lo decimos claro en vez de firmar basura. */
export function credencialesFaltantes(env) {
  return ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].filter(
    (k) => !env[k]
  );
}

export function crearCliente(env) {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

/** https://<account>.r2.cloudflarestorage.com/cargas-clientes/<clave> */
function urlObjeto(env, clave) {
  const ruta = clave.split("/").map(encodeURIComponent).join("/");
  return new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${ruta}`
  );
}

/**
 * URL prefirmada para subir. No firmamos Content-Type a proposito:
 * aws4fetch lo trata como cabecera no firmable y R2 acepta cabeceras sin firmar
 * en autenticacion por query, asi que el navegador puede mandar su propio tipo
 * sin que la firma deje de cuadrar.
 */
export async function firmarPut(cliente, env, clave, segundos = 3600) {
  const url = urlObjeto(env, clave);
  url.searchParams.set("X-Amz-Expires", String(segundos));

  const firmada = await cliente.sign(url.toString(), {
    method: "PUT",
    aws: { signQuery: true },
  });
  return firmada.url;
}

/**
 * URL prefirmada para descargar. `descarga` fuerza el "Guardar como" con el
 * nombre original en vez de que el navegador reproduzca el video.
 */
export async function firmarGet(cliente, env, clave, segundos = 3600, descarga = null) {
  const url = urlObjeto(env, clave);
  url.searchParams.set("X-Amz-Expires", String(segundos));
  if (descarga) {
    url.searchParams.set(
      "response-content-disposition",
      `attachment; filename="${descarga.replace(/"/g, "")}"`
    );
  }

  const firmada = await cliente.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return firmada.url;
}
