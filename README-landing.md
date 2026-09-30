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
Las fuentes Archivo condensada (titulares), Inter Tight (texto) y JetBrains Mono
(etiquetas) se cargan desde Google Fonts.

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

La estructura sigue la de dayos.com: hero con torre 3D, seccion negra
redondeada, producto destacado (Afluya) en laptop, tres animaciones de proceso,
carrusel de proyectos, rejilla de integraciones, carrusel de servicios, dos CTAs
y footer. El codigo 3D vive en `src/scene/`:

- `tower.js`: torre hexagonal de piezas (terrazo, basalto, madera y resina de
  color) rotuladas con los proyectos. Las piezas salen y entran sin parar, con
  reflejo en el piso. Renderiza a la densidad real de la pantalla (hasta 2x).
- `mini.js`: un solo renderer fuera de pantalla dibuja las tres animaciones de
  proceso y las imagenes de las tarjetas de servicios en canvas 2D.
- `materials.js`: texturas procedurales compartidas.

El scroll suave usa Lenis. Todo se pausa fuera de pantalla o con la pestana
oculta, hay boton de pausa y se respeta el movimiento reducido. Si WebGL falla
se muestra una silueta plana y el contenido sigue disponible.
