/**
 * ZIP64 en streaming, metodo STORE (sin comprimir).
 *
 * Por que asi:
 *  - STORE: fotos y videos ya vienen comprimidos; comprimir solo quema CPU.
 *  - Streaming: no cabe una carpeta de varios GB en memoria del Worker.
 *  - ZIP64 siempre: un solo video de celular puede pasar los 4 GB.
 *  - Descriptor de datos (bit 3): el CRC se calcula al vuelo, mientras pasan
 *    los bytes, asi que no lo conocemos al escribir la cabecera local.
 */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, previo = 0) {
  let c = ~previo >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c = (c >>> 8) ^ TABLA_CRC[(c ^ bytes[i]) & 0xff];
  }
  return ~c >>> 0;
}

/** Escritor secuencial little-endian sobre un buffer de tamano fijo. */
class Buf {
  constructor(n) {
    this.b = new Uint8Array(n);
    this.v = new DataView(this.b.buffer);
    this.o = 0;
  }
  u16(x) {
    this.v.setUint16(this.o, x, true);
    this.o += 2;
    return this;
  }
  u32(x) {
    this.v.setUint32(this.o, x >>> 0, true);
    this.o += 4;
    return this;
  }
  u64(x) {
    this.v.setBigUint64(this.o, BigInt(x), true);
    this.o += 8;
    return this;
  }
  bytes(a) {
    this.b.set(a, this.o);
    this.o += a.length;
    return this;
  }
}

const SIN_ZIP64_32 = 0xffffffff;
const FLAGS = 0x0008 | 0x0800; // descriptor de datos + nombres en UTF-8
const VERSION = 45; // requiere ZIP64

/** Fecha/hora en formato MS-DOS. */
function fechaDos(d = new Date()) {
  const hora =
    (Math.floor(d.getSeconds() / 2) & 0x1f) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((d.getHours() & 0x1f) << 11);
  const fecha =
    (d.getDate() & 0x1f) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    ((Math.max(0, d.getFullYear() - 1980) & 0x7f) << 9);
  return { hora, fecha };
}

function cabeceraLocal(nombre, dos) {
  // 30 fijos + nombre + 20 del campo extra ZIP64
  const b = new Buf(30 + nombre.length + 20);
  b.u32(0x04034b50)
    .u16(VERSION)
    .u16(FLAGS)
    .u16(0) // STORE
    .u16(dos.hora)
    .u16(dos.fecha)
    .u32(0) // CRC: va en el descriptor
    .u32(SIN_ZIP64_32) // tam. comprimido -> ZIP64
    .u32(SIN_ZIP64_32) // tam. sin comprimir -> ZIP64
    .u16(nombre.length)
    .u16(20) // longitud del campo extra
    .bytes(nombre)
    .u16(0x0001) // ZIP64
    .u16(16)
    .u64(0) // se rellenan en el descriptor
    .u64(0);
  return b.b;
}

function descriptorDatos(crc, tamano) {
  const b = new Buf(24);
  b.u32(0x08074b50).u32(crc).u64(tamano).u64(tamano);
  return b.b;
}

function cabeceraCentral(e, dos) {
  const b = new Buf(46 + e.nombre.length + 28);
  b.u32(0x02014b50)
    .u16(VERSION) // version que lo creo
    .u16(VERSION) // version necesaria
    .u16(FLAGS)
    .u16(0) // STORE
    .u16(dos.hora)
    .u16(dos.fecha)
    .u32(e.crc)
    .u32(SIN_ZIP64_32)
    .u32(SIN_ZIP64_32)
    .u16(e.nombre.length)
    .u16(28) // campo extra ZIP64
    .u16(0) // comentario
    .u16(0) // disco
    .u16(0) // atributos internos
    .u32(0) // atributos externos
    .u32(SIN_ZIP64_32) // offset -> ZIP64
    .bytes(e.nombre)
    .u16(0x0001)
    .u16(24)
    .u64(e.tamano)
    .u64(e.tamano)
    .u64(e.inicio);
  return b.b;
}

function cierre(entradas, inicioCentral, tamanoCentral) {
  const n = entradas.length;
  const b = new Buf(56 + 20 + 22);
  // EOCD64
  b.u32(0x06064b50)
    .u64(44) // tamano del registro restante
    .u16(VERSION)
    .u16(VERSION)
    .u32(0) // disco
    .u32(0) // disco del directorio central
    .u64(n)
    .u64(n)
    .u64(tamanoCentral)
    .u64(inicioCentral);
  // Localizador del EOCD64
  b.u32(0x07064b50).u32(0).u64(inicioCentral + tamanoCentral).u32(1);
  // EOCD clasico, todo a "mirame el ZIP64"
  b.u32(0x06054b50)
    .u16(0xffff)
    .u16(0xffff)
    .u16(0xffff)
    .u16(0xffff)
    .u32(SIN_ZIP64_32)
    .u32(SIN_ZIP64_32)
    .u16(0);
  return b.b;
}

/**
 * @param {{nombre: string}[]} entradas  nombre = ruta dentro del zip
 * @param {(entrada) => Promise<ReadableStream|null>} abrir
 * @returns {ReadableStream<Uint8Array>}
 */
export function crearZip(entradas, abrir) {
  const codificador = new TextEncoder();
  const dos = fechaDos();

  async function* generar() {
    const central = [];
    let offset = 0n;

    for (const entrada of entradas) {
      let cuerpo;
      try {
        cuerpo = await abrir(entrada);
      } catch {
        cuerpo = null;
      }
      if (!cuerpo) continue; // el objeto desaparecio (lifecycle); lo saltamos

      const nombre = codificador.encode(entrada.nombre);
      const inicio = offset;

      const lfh = cabeceraLocal(nombre, dos);
      yield lfh;
      offset += BigInt(lfh.length);

      let crc = 0;
      let tamano = 0n;
      const lector = cuerpo.getReader();
      while (true) {
        const { done, value } = await lector.read();
        if (done) break;
        crc = crc32(value, crc);
        tamano += BigInt(value.length);
        yield value;
      }
      offset += tamano;

      const dd = descriptorDatos(crc, tamano);
      yield dd;
      offset += BigInt(dd.length);

      central.push({ nombre, crc, tamano, inicio });
    }

    const inicioCentral = offset;
    let tamanoCentral = 0n;
    for (const e of central) {
      const cd = cabeceraCentral(e, dos);
      yield cd;
      tamanoCentral += BigInt(cd.length);
    }

    yield cierre(central, inicioCentral, tamanoCentral);
  }

  const it = generar();
  return new ReadableStream({
    async pull(controlador) {
      try {
        const { done, value } = await it.next();
        if (done) controlador.close();
        else controlador.enqueue(value);
      } catch (e) {
        controlador.error(e);
      }
    },
    cancel() {
      it.return?.();
    },
  });
}
