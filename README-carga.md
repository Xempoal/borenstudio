# Portal de carga de archivos — borenstudio.com/carga

Link público donde un cliente escribe el nombre de su negocio, adjunta fotos y
videos, y los sube **en calidad original**. Cada envío cae en su propia carpeta
dentro del bucket de R2 `cargas-clientes`, y todo se borra solo a los 10 días.

- **Portal del cliente:** <https://borenstudio.com/carga>
- **Panel interno:** <https://borenstudio.com/carga/admin> (se entra con un PIN)

Topes vigentes: **2 GB por envío**, **20 archivos por envío** y **9.99 GB por
periodo de 32 días**.

---

## Cómo funciona

```
Navegador                Pages Function              R2 (cargas-clientes)
   │                          │                             │
   │ POST /api/firmar ───────►│                             │
   │                          │ firma SigV4 (aws4fetch)     │
   │◄──── URLs prefirmadas ───│                             │
   │                          │                             │
   │ PUT archivo ────────────────────────────────────────►  │  ← directo, no pasa por el Worker
```

El navegador sube **directo a R2**. Los bytes nunca cruzan la Function: el
límite de body de un Worker es de 100 MB y un video de celular en calidad
original lo revienta. La Function solo firma URLs, que son texto.

No hay notificaciones de ningún tipo. Para ver qué llegó, entra al panel.

### Estructura de las claves

```
<slug-del-negocio>/<YYYY-MM-DD_HHmm>/<nombre-archivo>

hamburguesas-tony/2026-08-14_1432/promo.mp4
```

El slug sale del nombre que escribe el cliente (minúsculas, sin acentos,
espacios a guiones). El timestamp se calcula **una sola vez por envío, en el
servidor**, en hora de Ciudad de México — así toda la tanda queda junta y el
reloj del celular del cliente no puede mentir. Un segundo envío del mismo
cliente cae en una carpeta nueva.

No hay base de datos: **el estado vive en las claves de R2**.

### Archivos

| Archivo | Qué hace |
|---|---|
| `carga/index.html` | Portal del cliente (HTML/CSS/JS, sin frameworks) |
| `carga/manifest.webmanifest` | PWA instalable. **Sin service worker**, a propósito |
| `carga/admin/index.html` | Panel interno |
| `functions/api/firmar.js` | Valida y devuelve URLs prefirmadas (PUT, 1 h) |
| `functions/carga/admin/api/[[ruta]].js` | API del panel: carpetas, archivos, zip |
| `functions/_lib/firma.js` | Firma SigV4 contra el endpoint S3 de R2 |
| `functions/_lib/aws4fetch.js` | Copia de aws4fetch integrada al repo (ver abajo) |
| `functions/_lib/slug.js` | Slugs, sanitizado de nombres, validación de prefijos |
| `functions/_lib/panel.js` | Candado del panel: PIN, sesión firmada, bloqueos |
| `functions/_lib/cuota.js` | Cuota mensual de 9.99 GB por ventana de 32 días |
| `src/estilos.css` | Fuente de Tailwind (se compila a mano, ver abajo) |
| `carga/assets/estilos.css` | CSS ya compilado — **no editar** |
| `carga/assets/motion.js` | Motion (mini) empaquetado — **no editar** |
| `functions/_lib/zip.js` | ZIP64 en streaming para "descargar toda la carpeta" |
| `functions/_lib/http.js` | Helpers de respuesta y chequeo de origen |
| `infra/cors.json` | Configuración CORS aplicada al bucket |
| `infra/lifecycle.json` | Regla de borrado a los 10 días |

> Todo lo que está bajo `functions/_lib/` **no se enruta**: Pages ignora las
> carpetas que empiezan con `_`. Son módulos internos, no endpoints.

### Por qué aws4fetch está copiada dentro del repo

El proyecto de Pages **no tiene build command**. Cloudflare lo dice en el log:

```
No build command specified. Skipping build step.
```

Es decir: no corre `npm install`, así que al empaquetar las Functions el
bundler no encuentra el paquete y el deploy falla con
`Could not resolve "aws4fetch"`.

En vez de agregarle un paso de build a un sitio que nunca lo tuvo (más lento
y una pieza más que se puede romper), la librería vive copiada en
`functions/_lib/aws4fetch.js`. Son 11 KB sin dependencias, licencia MIT.

Para actualizarla:

```bash
npm install aws4fetch@latest
npm run vendor:aws4fetch      # regenera el archivo con su encabezado
```

**No la edites a mano.** En `package.json` aparece como `devDependency`
justamente para dejar claro que la copia del repo es la que corre en
producción.

> Si algún día le pones un build command real al proyecto (`npm ci`, por
> ejemplo), puedes volver al import normal `from "aws4fetch"` y borrar la copia.

---

## 1. Secrets

**Ninguna credencial vive en el código ni en `wrangler.jsonc`.** Todas son
secrets del proyecto de Pages.

| Secret | Para qué | De dónde sale |
|---|---|---|
| `R2_ACCOUNT_ID` | Endpoint S3 de R2 | Dashboard → R2 → *Account ID* |
| `R2_ACCESS_KEY_ID` | Firmar URLs | Token de API de R2 (abajo) |
| `R2_SECRET_ACCESS_KEY` | Firmar URLs | Token de API de R2 (abajo) |
| `PANEL_PIN` | Entrar al panel | Lo eliges tú (6 dígitos) |
| `PANEL_SESSION_SECRET` | Firmar la sesión del panel | 32 bytes aleatorios |

### Crear las llaves S3 de R2

Wrangler **no** puede crearlas; solo se hacen desde el dashboard:

1. Cloudflare Dashboard → **R2** → **Manage R2 API Tokens** → *Create API token*
2. Permiso: **Object Read & Write**
3. Alcance: solo el bucket `cargas-clientes`
4. Copia **Access Key ID** y **Secret Access Key** (el secret se muestra una sola vez)

### Cargarlos

```bash
export CLOUDFLARE_API_TOKEN=...    # o: npx wrangler login

npx wrangler pages secret put R2_ACCOUNT_ID          --project-name borenstudio
npx wrangler pages secret put R2_ACCESS_KEY_ID       --project-name borenstudio
npx wrangler pages secret put R2_SECRET_ACCESS_KEY   --project-name borenstudio
npx wrangler pages secret put PANEL_PIN               --project-name borenstudio
npx wrangler pages secret put PANEL_SESSION_SECRET    --project-name borenstudio
```

Los previews tienen su propio almacén de secrets. Para que las ramas de prueba
funcionen, repite cada comando con `--env preview`.

**Para cambiar el PIN** basta con volver a correr su comando y desplegar de
nuevo no hace falta: los secrets se leen en cada petición.

**La llave de sesión** se genera así, y nadie la teclea:

```bash
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
```

Cambiarla cierra todas las sesiones abiertas al instante — es la forma de
sacar a alguien que ya entró.

Cada comando pide el valor por consola (no queda en el historial de la shell).
Para listar lo que ya está cargado:

```bash
npx wrangler pages secret list --project-name borenstudio
```

> Si el nombre del proyecto de Pages no es `borenstudio`, ajústalo en todos los
> comandos y en `wrangler.jsonc`. Confírmalo con `npx wrangler pages project list`.

### Desarrollo local

Copia `.dev.vars.example` a `.dev.vars` y llénalo. Ese archivo está en
`.gitignore` y nunca se sube.

```bash
npm install
npm run dev        # http://127.0.0.1:8788/carga
```

---

## 2. El bucket y su CORS

```bash
npx wrangler r2 bucket create cargas-clientes
npx wrangler r2 bucket cors set cargas-clientes --file infra/cors.json -y
npx wrangler r2 bucket cors list cargas-clientes     # para verificar
```

`infra/cors.json`:

```json
{
  "rules": [
    {
      "id": "subida-directa-desde-borenstudio",
      "allowed": {
        "origins": [
          "https://borenstudio.com",
          "https://www.borenstudio.com",
          "https://borenstudio.pages.dev"
        ],
        "methods": ["PUT", "GET", "HEAD"],
        "headers": ["*"]
      },
      "exposeHeaders": ["ETag", "Content-Length", "Content-Type"],
      "maxAgeSeconds": 3600
    }
  ]
}
```

> Ojo con el formato: wrangler espera el esquema de la **API de R2**
> (`{"rules":[{"allowed":{...}}]}`), **no** el de S3 (`[{"AllowedOrigins":...}]`).
> Con el esquema de S3 falla con *"must contain a 'rules' array"*.

**Sin este CORS la subida falla en el navegador sin mensaje claro.** Si ves un
error de red genérico en la consola justo al empezar un `PUT`, revisa esto
primero. Si conectas un dominio nuevo (otro preview, otro apex), agrégalo a
`AllowedOrigins` y vuelve a correr el `cors set`.

---

## 3. Borrado automático a los 10 días

Es **configuración del bucket**, no un cron ni código nuestro.

```bash
npx wrangler r2 bucket lifecycle set cargas-clientes --file infra/lifecycle.json -y
npx wrangler r2 bucket lifecycle list cargas-clientes
```

`infra/lifecycle.json` borra todo objeto a los `864000` segundos (10 días) y
además limpia subidas multiparte abandonadas al día. Para cambiar el plazo,
edita `maxAge` (en segundos) y vuelve a correr el comando:

| Plazo | `maxAge` |
|---|---|
| 7 días | `604800` |
| 10 días | `864000` |
| 30 días | `2592000` |

---

## 4. El candado del panel: PIN

No hay Cloudflare Access ni cuentas. Se entra con un PIN de 6 dígitos y la
sesión dura 24 h.

| Cosa | Valor |
|---|---|
| PIN | secret `PANEL_PIN` (nunca en el código) |
| Duración de la sesión | 24 h |
| Intentos por dispositivo | 2, luego 3 h de bloqueo |
| Tope global | 20 fallos en 3 h bloquea a todos |

### Cómo se defiende un PIN de 6 dígitos

Un millón de combinaciones no es mucho, así que el bloqueo es lo que sostiene
la seguridad. Tres piezas:

1. **Por dispositivo (2 fallos → 3 h).** Es el límite que se ve al usar el
   panel. Va primero a propósito: quien falla se bloquea a sí mismo.
2. **Global (20 fallos → 3 h).** Sin esto, alguien que rote direcciones IP
   tendría intentos infinitos y el PIN caería en días. Con el tope son ~160
   intentos al día: agotar el millón tomaría siglos.
3. **Comparación de tiempo constante.** Comparar el PIN con `===` filtra
   información por lo que tarda en fallar. Ver `functions/_lib/panel.js`.

> **Por qué el tope por dispositivo va antes que el global:** si el único
> límite fuera global, cualquiera que encontrara la dirección podría teclear
> mal 20 veces y dejarte fuera 3 horas. Así, un curioso solo se bloquea él.

### La sesión

No se guarda en ningún lado. Es un token firmado con HMAC que lleva su propia
fecha de expiración, en una cookie `HttpOnly; Secure; SameSite=Strict` acotada
a `/carga/admin`. Sin estado que sincronizar y sin sesiones que limpiar.

### Cambiar el PIN

```bash
npx wrangler pages secret put PANEL_PIN --project-name borenstudio
```

Toma efecto de inmediato, sin desplegar. **Para sacar a alguien que ya entró**,
cambia además `PANEL_SESSION_SECRET`: eso invalida todas las sesiones abiertas.

### Quitar un bloqueo antes de las 3 h

Los bloqueos viven en KV y caducan solos. Para borrarlos a mano:

```bash
npx wrangler kv key list  --namespace-id eed7373c61644e9fad39c56355cfd191
npx wrangler kv key delete bloqueo:global --namespace-id eed7373c61644e9fad39c56355cfd191
```

---

## 5. Los límites y cómo cambiarlos

Todos los límites se validan **dos veces**: en el navegador para dar un mensaje
inmediato, y en el servidor porque el navegador se puede manipular. Si cambias
uno, cámbialo en los dos lados o el cliente verá mensajes que no coinciden con
lo que realmente pasa.

| Límite | Valor | Servidor | Cliente |
|---|---|---|---|
| Archivos por envío | 20 | `functions/api/firmar.js` → `MAX_ARCHIVOS` | `carga/index.html` → `MAX_ARCHIVOS` |
| Peso de un archivo | 2 GB | `functions/api/firmar.js` → `MAX_BYTES_ARCHIVO` | `carga/index.html` → `MAX_BYTES_ARCHIVO` |
| Peso del envío completo | 2 GB | `functions/_lib/cuota.js` → `TOPE_TANDA` | `carga/index.html` → `MAX_BYTES_TANDA` |
| Cuota del periodo | 9.99 GB | `functions/_lib/cuota.js` → `TOPE_MENSUAL` | — |
| Largo del periodo | 32 días | `functions/_lib/cuota.js` → `DIAS_VENTANA` | — |
| Vigencia de las URLs | 1 h | `functions/api/firmar.js` → `VIGENCIA_SEGUNDOS` | — |
| Subidas en paralelo | 3 | — | `carga/index.html` → `PARALELO` |
| Reintentos por archivo | 2 | — | `carga/index.html` → `REINTENTOS` |

Los textos visibles ("2 GB", "20", "10 días" en la ficha técnica) están escritos
a mano en el HTML: actualízalos también.

### Cómo funciona la cuota del periodo

La ventana arranca el **14 de agosto de 2026** (`INICIO_PRIMERA_VENTANA` en
`functions/_lib/cuota.js`) y dura 32 días. Al consultarla, si ya se pasó el
plazo, el contador vuelve a cero solo — sin importar cuánto se haya subido.
No hay cron ni tarea programada: se calcula al vuelo.

**Los GB se descuentan al firmar, no al terminar la subida.** Es lo que evita
que veinte subidas simultáneas rebasen el límite antes de poder bloquear
ninguna. El costo es que una subida abandonada deja sus GB apartados hasta que
la ventana se reinicie.

Para devolver espacio a mano, edita el contador en KV:

```bash
npx wrangler kv key get cuota --namespace-id eed7373c61644e9fad39c56355cfd191
# {"inicio":1755147600000,"usado":2147483648}
echo '{"inicio":1755147600000,"usado":0}' > /tmp/c.json
npx wrangler kv key put cuota --path /tmp/c.json --namespace-id eed7373c61644e9fad39c56355cfd191
```

> Si subes `MAX_BYTES_ARCHIVO` por encima de 2 GB: R2 acepta hasta **5 GB** en
> un `PUT` simple. Más que eso exige subida multiparte, que es otro diseño.
>
> Si subes `PARALELO` por encima de 3, en 4G lento las conexiones se ahogan
> entre sí y el progreso se ve congelado. 3 es un valor probado, no arbitrario.

---

## 6. Compilar el diseño

El CSS y la librería de animación **se compilan a mano** y el resultado se sube
al repo, porque Cloudflare no corre build en este proyecto (lo mismo que pasa
con aws4fetch).

```bash
npm run css      # src/estilos.css        -> carga/assets/estilos.css
npm run motion   # motion/mini            -> carga/assets/motion.js
npm run build    # las dos, más aws4fetch
```

Mientras diseñas: `npm run css:watch`.

**Edita `src/estilos.css`, nunca `carga/assets/estilos.css`** — ese último se
regenera y perderías los cambios. Si tocas el HTML y agregas clases nuevas de
Tailwind, hay que volver a correr `npm run css` o esas clases no existirán en
producción.

Peso de lo que se agregó: ~6.4 KB de CSS y ~5 KB de JS, comprimidos.

---

## 7. Desplegar

El proyecto está conectado a GitHub (`Xempoal/borenstudio`), así que el deploy
normal es un push:

```bash
git add .
git commit -m "..."
git push
```

Cloudflare Pages construye solo. Para un deploy manual de emergencia:

```bash
npx wrangler pages deploy --project-name borenstudio
```

---

## Decisiones que conviene no deshacer

- **Sin service worker.** La página tiene que estar siempre fresca: una copia
  cacheada serviría URLs prefirmadas ya vencidas. El manifest da la instalación
  como app; el service worker no hace falta.
- **`XMLHttpRequest` en vez de `fetch`.** `fetch` no reporta progreso de subida.
  Sin barra por archivo, un cliente subiendo 2 GB desde el celular no sabe si
  la cosa avanza o está colgada.
- **El bloqueo del PIN es por dispositivo antes que global.** Un tope solo
  global convierte el candado en un botón para dejarte fuera 3 horas.
- **La cuota se descuenta al firmar.** Contar solo lo que llegó completo deja
  una rendija por la que varias subidas simultáneas rebasan el límite.
- **El CSS y el JS de animación se compilan a mano y se suben ya hechos.**
  Cloudflare no corre build aquí; meterle uno solo por el diseño agregaría un
  paso que se puede romper en cada deploy.
- **Sin notificaciones.** No hay bot, ni correo, ni webhook: el panel es la
  única forma de ver qué llegó. Menos piezas que se pueden romper y un secret
  menos que rotar.
- **El ZIP del panel es ZIP64 sin comprimir.** Fotos y videos ya vienen
  comprimidos; comprimir solo quema CPU. Se arma en streaming porque una
  carpeta de varios GB no cabe en la memoria de un Worker.
