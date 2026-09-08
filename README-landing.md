# Landing de Boren Studio

La portada es `index.html`. Usa `assets/studio.css` y el archivo compilado
`assets/studio.bundle.js`. El codigo fuente de Three.js, GSAP ScrollTrigger y
los iconos Lucide esta en `src/studio.js`.

## Desarrollo

```sh
npm ci
npm run build:landing
npm run dev -- --port 8790
```

Tambien se puede abrir `index.html` directamente para revisar la portada.
Las fuentes Syne, Newsreader y Manrope se cargan desde Google Fonts.

## Verificacion

```sh
npx playwright install chromium
npm run test:landing
```

Las pruebas levantan Cloudflare Pages localmente en el puerto 8790 y verifican
cuatro tamanos de pantalla, pixeles del canvas, movimiento, pausa, imagenes,
acordeones y alternativas para movimiento reducido y WebGL no disponible.
Las capturas quedan en `test-results/` (ignorado por Git).

## Publicacion

Cloudflare Pages sirve la raiz del repositorio sin ejecutar un build remoto.
Despues de editar `src/studio.js`, ejecutar `npm run build:landing` e incluir
`assets/studio.bundle.js` (incluye avisos de licencia) en el commit. Al cambiar CSS
o JavaScript, actualizar la version de sus URLs en `index.html` para invalidar
la cache de assets. El portal de clientes y los otros sitios conservan sus
archivos y comandos existentes.

El modelo B esta construido con geometria propia. Se pausa al salir de pantalla
o cambiar de pestana, limita la densidad de pixeles a 1.5 y respeta la preferencia
de movimiento reducido. Si WebGL falla, se muestra una B tipografica y el
contenido sigue disponible.
