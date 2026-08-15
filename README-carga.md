# Portal de carga de archivos — borenstudio.com/carga

Link público donde un cliente escribe el nombre de su negocio, adjunta fotos y
videos, y los sube **en calidad original**. Cada envío cae en su propia carpeta
dentro del bucket de R2 `cargas-clientes`, y todo se borra solo a los 10 días.

- **Portal del cliente:** <https://borenstudio.com/carga>
- **Panel interno:** <https://borenstudio.com/carga/admin> (protegido con Cloudflare Access)

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
| `functions/_lib/access.js` | Verifica el JWT de Cloudflare Access |
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
```

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

## 4. Cloudflare Access sobre `/carga/admin*`

No hay sistema de login propio. El panel se protege con Access, y **además** la
API verifica el JWT del lado del servidor (`functions/_lib/access.js`), porque
la política de Access cubre `borenstudio.com` pero no `*.pages.dev`.

### Lo que ya está configurado

| Cosa | Valor |
|---|---|
| Team domain | `borenstudio.cloudflareaccess.com` |
| Aplicación | `Panel de cargas` (self-hosted) |
| Ruta protegida | `borenstudio.com/carga/admin` (y todo lo que cuelga debajo) |
| Duración de sesión | 24 h |
| Método de login | Código por correo (One-time PIN) |
| Política | *Allow* → `xempoal@gmail.com` |

Esos dos identificadores están en `wrangler.jsonc` → `vars`:

```jsonc
"vars": {
  "ACCESS_TEAM_DOMAIN": "borenstudio.cloudflareaccess.com",
  "ACCESS_AUD": "d0cdbe6a...el-tag-largo"
}
```

No son secretos: son identificadores públicos. Pero **sin ellos el panel
responde 503 a propósito** — falla cerrado en vez de quedar abierto.

### Agregar o quitar personas

Zero Trust → **Access** → **Applications** → *Panel de cargas* → pestaña
**Policies** → *Solo Boren Studio* → agrega correos en el bloque **Emails**.

No hace falta tocar código ni volver a desplegar: la política se aplica al
instante.

### Si algún día cambias la app de Access

Si borras y recreas la aplicación, el **AUD tag cambia** y el panel se cierra
con 401 (*"El token no es para esta aplicación"*). Copia el AUD nuevo a
`wrangler.jsonc` y vuelve a desplegar.

---

## 5. Cambiar los límites

Los límites están en **dos** lugares y tienen que coincidir, porque el cliente
valida antes de subir y el servidor valida otra vez (nunca confíes solo en el
navegador).

| Límite | Servidor | Cliente |
|---|---|---|
| Máx. archivos por envío | `functions/api/firmar.js` → `MAX_ARCHIVOS` | `carga/index.html` → `MAX_ARCHIVOS` |
| Máx. peso por archivo | `functions/api/firmar.js` → `MAX_BYTES_ARCHIVO` | `carga/index.html` → `MAX_BYTES` |
| Vigencia de las URLs | `functions/api/firmar.js` → `VIGENCIA_SEGUNDOS` | — |
| Subidas en paralelo | — | `carga/index.html` → `PARALELO` |
| Reintentos por archivo | — | `carga/index.html` → `REINTENTOS` |

Si subes mucho `MAX_BYTES_ARCHIVO`: R2 acepta hasta **5 GB** en un `PUT` simple.
Más que eso exige subida multiparte, que es otro diseño.

Si subes `PARALELO` por encima de 3, en 4G lento las conexiones se ahogan entre
sí y el progreso se ve congelado. 3 es un valor probado, no arbitrario.

Los textos visibles ("Hasta 20 archivos · 2 GB cada uno") están en el HTML y
hay que actualizarlos a mano.

---

## 6. Desplegar

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
- **Sin notificaciones.** No hay bot, ni correo, ni webhook: el panel es la
  única forma de ver qué llegó. Menos piezas que se pueden romper y un secret
  menos que rotar.
- **El ZIP del panel es ZIP64 sin comprimir.** Fotos y videos ya vienen
  comprimidos; comprimir solo quema CPU. Se arma en streaming porque una
  carpeta de varios GB no cabe en la memoria de un Worker.
