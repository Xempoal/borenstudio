/**
 * Normalizacion de nombres -> claves de R2.
 *
 * Todo lo que llega del cliente pasa por aqui antes de tocar una clave de objeto.
 * La regla es simple: la clave final solo puede contener [a-z0-9._-] y "/" como
 * separador que ponemos NOSOTROS, nunca el cliente.
 */

const MAX_SLUG = 60;
const MAX_ARCHIVO = 120;

/** Quita acentos y diacriticos: "Hamburguesas Toñy" -> "Hamburguesas Tony". */
function sinAcentos(texto) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Slug del negocio: minusculas, sin acentos, espacios a guiones, sin rarezas.
 * "  Hamburguesas Toñy!!  " -> "hamburguesas-tony"
 */
export function slugNegocio(nombre) {
  const base = sinAcentos(String(nombre || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
  return base || "sin-nombre";
}

/**
 * Nombre de archivo seguro. Descarta cualquier intento de ruta.
 * "../../etc/passwd" -> "passwd";  "C:\fotos\a b.JPG" -> "a-b.JPG"
 */
export function sanitizarArchivo(nombre) {
  // Nos quedamos solo con el ultimo segmento: mata "../", rutas absolutas y "C:\".
  const soloNombre = String(nombre || "").split(/[\\/]/).pop() || "";

  let limpio = sinAcentos(soloNombre)
    // Caracteres de control y todo lo que no sea seguro en una clave.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    // Un punto inicial esconde el archivo; varios puntos seguidos huelen a "..".
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\-_]+/, "");

  if (limpio.length > MAX_ARCHIVO) {
    // Recortamos el cuerpo, no la extension.
    const punto = limpio.lastIndexOf(".");
    const ext = punto > 0 ? limpio.slice(punto, punto + 12) : "";
    limpio = limpio.slice(0, MAX_ARCHIVO - ext.length) + ext;
  }

  return limpio || "archivo";
}

/**
 * Carpeta de la tanda: YYYY-MM-DD_HHmm en hora de Ciudad de Mexico.
 * Se calcula UNA sola vez por sesion de subida, en el servidor, para que
 * todos los archivos de la tanda caigan juntos y el reloj del cliente no mienta.
 */
export function carpetaTimestamp(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(fecha);

  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  const hora = p.hour === "24" ? "00" : p.hour; // en-CA puede dar "24" a medianoche
  return `${p.year}-${p.month}-${p.day}_${hora}${p.minute}`;
}

/** Forma exacta de un prefijo valido: "negocio/2026-08-14_1432/" */
export const RE_PREFIJO = /^[a-z0-9][a-z0-9-]{0,59}\/\d{4}-\d{2}-\d{2}_\d{4}\/$/;

/** Valida un prefijo que vuelve del cliente (reintentos, panel admin). */
export function prefijoValido(prefijo) {
  return typeof prefijo === "string" && RE_PREFIJO.test(prefijo);
}
