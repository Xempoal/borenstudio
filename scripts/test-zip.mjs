import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { calcularTamanoZip, crearZip } from "../functions/_lib/zip.js";

assert.throws(
  () => crearZip([{ nombre: "demasiado-grande.bin", tamanoEsperado: 0xffffffff }], async () => null),
  /ZIP completo excede el limite/,
  "debe rechazar antes de transmitir un ZIP que superaria 4 GB"
);

const faltante = crearZip([{ nombre: "faltante.jpg", tamanoEsperado: 10 }], async () => null);
await assert.rejects(
  async () => {
    const r = faltante.getReader();
    while (!(await r.read()).done) {}
  },
  /No se pudo leer faltante\.jpg/,
  "un objeto faltante debe cortar la descarga, no desaparecer del ZIP"
);

const originales = new Map();
const entradas = Array.from({ length: 40 }, (_, i) => {
  const nombre = `cliente-prueba/2026-08-30_2200/foto-${String(i + 1).padStart(2, "0")}.jpg`;
  const bytes = new Uint8Array(4096 + i * 173);
  for (let j = 0; j < bytes.length; j++) bytes[j] = (i * 31 + j * 17) & 0xff;
  originales.set(nombre, bytes);
  return { nombre, tamanoEsperado: bytes.length };
});

const flujo = crearZip(entradas, async (e) => new Blob([originales.get(e.nombre)]).stream());
const lector = flujo.getReader();
const trozos = [];
while (true) {
  const { done, value } = await lector.read();
  if (done) break;
  trozos.push(Buffer.from(value));
}
const zip = Buffer.concat(trozos);
assert.equal(zip.length, calcularTamanoZip(entradas), "el Content-Length calculado debe ser exacto");
const vista = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
const u16 = (o) => vista.getUint16(o, true);
const u32 = (o) => vista.getUint32(o, true);

const eocd = zip.length - 22;
assert.equal(u32(eocd), 0x06054b50, "falta el cierre EOCD");
assert.equal(u16(eocd + 4), 0, "el ZIP no debe marcarse como multidisco");
assert.equal(u16(eocd + 6), 0, "el directorio central debe empezar en el disco 0");
assert.equal(u16(eocd + 8), 40);
assert.equal(u16(eocd + 10), 40);

const tamanoCentral = u32(eocd + 12);
const inicioCentral = u32(eocd + 16);
assert.equal(inicioCentral + tamanoCentral, eocd);

let central = inicioCentral;
for (let i = 0; i < 40; i++) {
  assert.equal(u32(central), 0x02014b50, `cabecera central ${i + 1} invalida`);
  const crc = u32(central + 16);
  const tamano = u32(central + 24);
  const largoNombre = u16(central + 28);
  const largoExtra = u16(central + 30);
  const largoComentario = u16(central + 32);
  const inicioLocal = u32(central + 42);
  const nombre = zip.subarray(central + 46, central + 46 + largoNombre).toString("utf8");
  const original = originales.get(nombre);

  assert.ok(original, `nombre inesperado: ${nombre}`);
  assert.equal(tamano, original.length);
  assert.equal(u32(inicioLocal), 0x04034b50);

  const largoLocal = u16(inicioLocal + 26);
  const extraLocal = u16(inicioLocal + 28);
  const inicioDatos = inicioLocal + 30 + largoLocal + extraLocal;
  assert.deepEqual(zip.subarray(inicioDatos, inicioDatos + tamano), Buffer.from(original));

  const descriptor = inicioDatos + tamano;
  assert.equal(u32(descriptor), 0x08074b50);
  assert.equal(u32(descriptor + 4), crc);
  assert.equal(u32(descriptor + 8), tamano);
  assert.equal(u32(descriptor + 12), tamano);

  central += 46 + largoNombre + largoExtra + largoComentario;
}
assert.equal(central, eocd);

if (process.argv[2]) await writeFile(process.argv[2], zip);
console.log(`ZIP válido: 40 archivos, ${zip.length} bytes, un solo volumen.`);
