/**
 * Verificacion del JWT de Cloudflare Access.
 *
 * La politica de Access sobre /carga/admin* protege el dominio publico, pero
 * el mismo proyecto tambien responde en <proyecto>.pages.dev, donde Access no
 * aplica. Sin esta verificacion, el panel seria publico por esa puerta.
 *
 * Falla cerrado: si no hay configuracion de Access, el panel no abre.
 */

const CACHE_JWKS = new Map(); // teamDomain -> { claves, expira }
const TTL_JWKS = 60 * 60 * 1000; // 1 h

function b64urlABytes(texto) {
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/");
  const relleno = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(relleno);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlAJson(texto) {
  return JSON.parse(new TextDecoder().decode(b64urlABytes(texto)));
}

function normalizarTeam(valor) {
  // Acepta "miequipo", "miequipo.cloudflareaccess.com" o la URL completa.
  let t = String(valor).trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!t.endsWith(".cloudflareaccess.com")) t = `${t}.cloudflareaccess.com`;
  return t;
}

async function obtenerClaves(teamDomain) {
  const cacheado = CACHE_JWKS.get(teamDomain);
  if (cacheado && cacheado.expira > Date.now()) return cacheado.claves;

  const r = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!r.ok) throw new Error(`No se pudieron leer las llaves de Access (${r.status})`);

  const { keys } = await r.json();
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error("Access no devolvio llaves.");
  }

  const claves = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== "RSA") continue;
    claves.set(
      jwk.kid,
      await crypto.subtle.importKey(
        "jwk",
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      )
    );
  }

  CACHE_JWKS.set(teamDomain, { claves, expira: Date.now() + TTL_JWKS });
  return claves;
}

/**
 * @returns {Promise<{ok: true, email: string} | {ok: false, estado: number, motivo: string}>}
 */
export async function verificarAcceso(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return {
      ok: false,
      estado: 503,
      motivo:
        "Cloudflare Access no esta configurado (ACCESS_TEAM_DOMAIN / ACCESS_AUD). El panel queda cerrado.",
    };
  }

  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    (request.headers.get("Cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];

  if (!token) {
    return { ok: false, estado: 401, motivo: "No hay sesion de Cloudflare Access." };
  }

  const partes = token.split(".");
  if (partes.length !== 3) {
    return { ok: false, estado: 401, motivo: "Token de Access malformado." };
  }

  const teamDomain = normalizarTeam(env.ACCESS_TEAM_DOMAIN);

  let cabecera, carga;
  try {
    cabecera = b64urlAJson(partes[0]);
    carga = b64urlAJson(partes[1]);
  } catch {
    return { ok: false, estado: 401, motivo: "Token de Access ilegible." };
  }

  if (cabecera.alg !== "RS256") {
    return { ok: false, estado: 401, motivo: "Algoritmo de token no soportado." };
  }

  let clave;
  try {
    clave = (await obtenerClaves(teamDomain)).get(cabecera.kid);
  } catch (e) {
    return { ok: false, estado: 503, motivo: String(e.message || e) };
  }
  if (!clave) {
    return { ok: false, estado: 401, motivo: "Token firmado con una llave desconocida." };
  }

  const firmaOk = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    clave,
    b64urlABytes(partes[2]),
    new TextEncoder().encode(`${partes[0]}.${partes[1]}`)
  );
  if (!firmaOk) {
    return { ok: false, estado: 401, motivo: "Firma del token invalida." };
  }

  const ahora = Math.floor(Date.now() / 1000);
  if (typeof carga.exp !== "number" || carga.exp < ahora - 60) {
    return { ok: false, estado: 401, motivo: "La sesion de Access expiro." };
  }
  if (typeof carga.nbf === "number" && carga.nbf > ahora + 60) {
    return { ok: false, estado: 401, motivo: "Token aun no valido." };
  }
  if (carga.iss !== `https://${teamDomain}`) {
    return { ok: false, estado: 401, motivo: "Emisor del token incorrecto." };
  }

  const aud = Array.isArray(carga.aud) ? carga.aud : [carga.aud];
  if (!aud.includes(env.ACCESS_AUD)) {
    return { ok: false, estado: 401, motivo: "El token no es para esta aplicacion." };
  }

  return { ok: true, email: carga.email || carga.common_name || "desconocido" };
}
