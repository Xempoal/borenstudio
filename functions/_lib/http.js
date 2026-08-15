/** Helpers chicos compartidos por las Functions. */

export function json(datos, estado = 200, cabeceras = {}) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...cabeceras,
    },
  });
}

export function error(mensaje, estado = 400, extra = {}) {
  return json({ ok: false, error: mensaje, ...extra }, estado);
}

/**
 * El firmador solo responde a nuestro propio sitio. Sin esto, cualquier pagina
 * ajena podria pedir URLs de subida y usar el bucket como hosting gratis.
 * (No es una defensa fuerte -- Origin se falsifica fuera del navegador -- pero
 * corta el abuso desde el navegador, que es de donde vendria.)
 */
export function origenPermitido(request) {
  const origen = request.headers.get("Origin");
  if (!origen) return true; // curl / same-origin sin Origin

  let host;
  try {
    host = new URL(origen).hostname;
  } catch {
    return false;
  }

  return (
    host === "borenstudio.com" ||
    host === "www.borenstudio.com" ||
    host.endsWith(".pages.dev") ||
    host === "localhost" ||
    host === "127.0.0.1"
  );
}

/** Lee JSON del body sin explotar si viene basura. */
export async function leerJson(request) {
  try {
    const datos = await request.json();
    return datos && typeof datos === "object" ? datos : null;
  } catch {
    return null;
  }
}
