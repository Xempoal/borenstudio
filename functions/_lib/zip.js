/**
 * ZIP estandar en streaming, metodo STORE (sin comprimir).
 *
 * Las fotos y videos ya vienen comprimidos, asi que STORE evita gastar CPU.
 * El cuerpo se transmite objeto por objeto: nunca se carga una carpeta entera
 * en la memoria del Worker.
 *
 * El portal limita cada tanda a 3 GB. Eso permite usar ZIP clasico (limite de
 * 4 GB) en vez de forzar ZIP64. ZIP clasico tiene mucha mejor compatibilidad
 * con el Explorador de Windows, macOS, Android y aplicaciones de mensajeria.
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

class Buf {
  constructor(n) {
    this.b = new Uint8Array(n);
    this.v = new DataView(this.b.buffer);
    this.o = 0;
  }
  u16(x) {
    this.v.setUint16(this.o, Number(x) & 0xffff, true);
    this.o += 2;
    return this;
  }
  u32(x) {
    this.v.setUint32(this.o, Number(x) >>> 0, true);
    this.o += 4;
    return this;
  }
  bytes(a) {
    this.b.set(a, this.o);
    this.o += a.length;
    return this;
  }
}

const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;
const FLAGS = 0x0008 | 0x0800; // descriptor de datos + nombres UTF-8
const VERSION = 20; // ZIP 2.0: descriptor de datos

/** Fecha/hora en formato MS-DOS. */
function fechaDos(d = new Date()) {
  const anio = Math.min(2107, Math.max(1980, d.getFullYear()));
  const hora =
    (Math.floor(d.getSeconds() / 2) & 0x1f) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((d.getHours() & 0x1f) << 11);
  const fecha =
    (d.getDate() & 0x1f) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (((anio - 1980) & 0x7f) << 9);
  return { hora, fecha };
}

function cabeceraLocal(nombre, dos) {
  const b = new Buf(30 + nombre.length);
  b.u32(0x04034b50)
    .u16(VERSION)
    .u16(FLAGS)
    .u16(0) // STORE
    .u16(dos.hora)
    .u16(dos.fecha)
    .u32(0) // CRC y tamanos van en el descriptor
    .u32(0)
    .u32(0)
    .u16(nombre.length)
    .u16(0)
    .bytes(nombre);
  return b.b;
}

function descriptorDatos(crc, tamano) {
  const b = new Buf(16);
  b.u32(0x08074b50).u32(crc).u32(tamano).u32(tamano);
  return b.b;
}

function cabeceraCentral(e, dos) {
  const b = new Buf(46 + e.nombre.length);
  b.u32(0x02014b50)
    .u16(VERSION)
    .u16(VERSION)
    .u16(FLAGS)
    .u16(0) // STORE
    .u16(dos.hora)
    .u16(dos.fecha)
    .u32(e.crc)
    .u32(e.tamano)
    .u32(e.tamano)
    .u16(e.nombre.length)
    .u16(0) // extra
    .u16(0) // comentario
    .u16(0) // disco donde empieza
    .u16(0) // atributos internos
    .u32(0) // atributos externos
    .u32(e.inicio)
    .bytes(e.nombre);
  return b.b;
}

function cierre(cantidad, inicioCentral, tamanoCentral) {
  const b = new Buf(22);
  b.u32(0x06054b50)
    .u16(0) // numero de disco: ZIP de un solo volumen
    .u16(0) // disco donde empieza el directorio central
    .u16(cantidad)
    .u16(cantidad)
    .u32(tamanoCentral)
    .u32(inicioCentral)
    .u16(0);
  return b.b;
}

function asegurarRango(valor, etiqueta) {
  if (!Number.isSafeInteger(valor) || valor < 0 || valor > MAX_U32) {
    throw new Error(`${etiqueta} excede el limite del ZIP de 4 GB.`);
  }
}

/** Tamaño exacto del ZIP STORE; permite al navegador detectar cortes. */
export function calcularTamanoZip(entradas) {
  if (entradas.length > MAX_U16) throw new Error("El ZIP contiene demasiados archivos.");
  const codificador = new TextEncoder();
  const total = entradas.reduce((acumulado, e) => {
    if (e.tamanoEsperado == null) throw new Error("Falta el tamaño de un archivo del ZIP.");
    asegurarRango(e.tamanoEsperado, `El archivo ${e.nombre}`);
    const largoNombre = codificador.encode(e.nombre).length;
    if (largoNombre > MAX_U16) throw new Error("Un nombre de archivo es demasiado largo.");
    return acumulado + 30 + largoNombre + e.tamanoEsperado + 16 + 46 + largoNombre;
  }, 22);
  asegurarRango(total, "El ZIP completo");
  return total;
}

/**
 * @param {{nombre:string,tamanoEsperado?:number}[]} entradas
 * @param {(entrada) => Promise<ReadableStream|null>} abrir
 * @returns {ReadableStream<Uint8Array>}
 */
export function crearZip(entradas, abrir) {
  if (entradas.length > MAX_U16) throw new Error("El ZIP contiene demasiados archivos.");

  const codificador = new TextEncoder();
  const dos = fechaDos();
  const preparadas = entradas.map((e) => {
    const nombre = codificador.encode(e.nombre);
    if (nombre.length > MAX_U16) throw new Error("Un nombre de archivo es demasiado largo.");
    if (e.tamanoEsperado != null) asegurarRango(e.tamanoEsperado, `El archivo ${e.nombre}`);
    return { ...e, nombreBytes: nombre };
  });

  // El panel conoce los tamaños de R2. Validamos el ZIP completo antes de
  // enviar el primer byte para nunca entregar una descarga truncada.
  if (preparadas.every((e) => e.tamanoEsperado != null)) calcularTamanoZip(preparadas);

  async function* generar() {
    const central = [];
    let offset = 0;

    for (const entrada of preparadas) {
      let cuerpo;
      try {
        cuerpo = await abrir(entrada);
      } catch {
        cuerpo = null;
      }
      if (!cuerpo) throw new Error(`No se pudo leer ${entrada.nombre}; vuelve a generar la descarga.`);

      const inicio = offset;
      const lfh = cabeceraLocal(entrada.nombreBytes, dos);
      yield lfh;
      offset += lfh.length;

      let crc = 0;
      let tamano = 0;
      const lector = cuerpo.getReader();
      try {
        while (true) {
          const { done, value } = await lector.read();
          if (done) break;
          crc = crc32(value, crc);
          tamano += value.length;
          asegurarRango(tamano, `El archivo ${entrada.nombre}`);
          yield value;
        }
      } finally {
        lector.releaseLock();
      }

      if (entrada.tamanoEsperado != null && tamano !== entrada.tamanoEsperado) {
        throw new Error(`El archivo ${entrada.nombre} cambio durante la descarga.`);
      }

      offset += tamano;
      const dd = descriptorDatos(crc, tamano);
      yield dd;
      offset += dd.length;
      asegurarRango(offset, "El contenido del ZIP");

      central.push({ nombre: entrada.nombreBytes, crc, tamano, inicio });
    }

    const inicioCentral = offset;
    let tamanoCentral = 0;
    for (const e of central) {
      const cd = cabeceraCentral(e, dos);
      yield cd;
      tamanoCentral += cd.length;
    }

    asegurarRango(inicioCentral, "El inicio del directorio central");
    asegurarRango(tamanoCentral, "El directorio central");
    asegurarRango(inicioCentral + tamanoCentral, "El ZIP completo");
    yield cierre(central.length, inicioCentral, tamanoCentral);
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
