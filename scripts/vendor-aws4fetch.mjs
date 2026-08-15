/**
 * Regenera functions/_lib/aws4fetch.js desde node_modules.
 *
 * Se usa asi:
 *   npm install aws4fetch@latest
 *   npm run vendor:aws4fetch
 *
 * Ver el encabezado de functions/_lib/aws4fetch.js para el por que.
 */

import { readFileSync, writeFileSync } from "node:fs";

const ORIGEN = "node_modules/aws4fetch/dist/aws4fetch.esm.mjs";
const DESTINO = "functions/_lib/aws4fetch.js";

const { version, license } = JSON.parse(
  readFileSync("node_modules/aws4fetch/package.json", "utf8")
);

const encabezado = `/**
 * aws4fetch v${version}  --  copia integrada al repo (vendored).
 * Licencia: ${license}. Origen: ${ORIGEN}
 *
 * Por que esta aqui y no en node_modules: el proyecto de Pages no tiene
 * build command, asi que Cloudflare no corre 'npm install' y el bundler
 * de Functions no puede resolver el import. Agregar un paso de build solo
 * por una libreria de 11 KB sin dependencias no vale la pena.
 *
 * NO editar a mano. Para actualizar:
 *   npm install aws4fetch@ultima && npm run vendor:aws4fetch
 */

`;

writeFileSync(DESTINO, encabezado + readFileSync(ORIGEN, "utf8"));
console.log(`${DESTINO} actualizado a aws4fetch v${version}`);
