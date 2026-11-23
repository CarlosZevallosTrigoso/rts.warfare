// rts.warfare — editor de mapas. Trabaja sobre el mismo objeto de mapa que genera el juego (W.generarMapa) y lo guarda con W.mapaAJSON.
// W.abrirEditor(raiz, op) monta el editor dentro de «raiz». op: { probar(json, id), salir(), abrir: id de un mapa guardado } (todo opcional).
// Devuelve { cargar, mapa, cerrar }: cerrar quita sus escuchas del teclado y de la ventana.
(function () {
  const W = globalThis.W;
  const C = { llano: '#f5f5f5', roca: '#5a5a5a', agua: '#aebfcc', bosque: '#c6cfbd', camino: '#d9d2c2', mineral: '#4d7a38', raro: '#7d5aa6', tinta: '#1a1a1a', suave: '#6e6e6e', yo: '#3b6ea5', rival: '#c9622b', mal: '#b0362f', aviso: '#a8741a' };
  const HERR = [
    ['Terreno', [['llano', 'Llano'], ['roca', 'Roca'], ['agua', 'Agua'], ['bosque', 'Bosque']]],
    ['Recursos', [['mineral', 'Mineral'], ['raro', 'Mineral raro'], ['sinRecurso', 'Quitar recursos']]],
    ['Sitios y puestos', [['petroleo', 'Petróleo'], ['conocimiento', 'Conocimiento'], ['antena', 'Antena'], ['deposito', 'Depósito'], ['taller', 'Taller'], ['quitarSitio', 'Quitar']]],
    ['Bases', [['base0', 'Base 1'], ['base1', 'Base 2']]],
  ];
  const PINCEL = { llano: 1, roca: 1, agua: 1, bosque: 1, mineral: 1, raro: 1, sinRecurso: 1 };
  const SITIO = { petroleo: 1, conocimiento: 1 }, PUESTO = { antena: 1, deposito: 1, taller: 1 };
  const CLAVE = 'rts.mapas';
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mezcla = (a, b, f) => [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));

  W.misMapas = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || '{}'); } catch (e) { return {}; } };
  W.guardarMiMapa = (id, json) => { const L = W.misMapas(); L[id] = { nombre: json.nombre || id, N: json.N, fecha: new Date().toISOString(), mapa: json }; localStorage.setItem(CLAVE, JSON.stringify(L)); };
  W.borrarMiMapa = (id) => { const L = W.misMapas(); delete L[id]; localStorage.setItem(CLAVE, JSON.stringify(L)); };

  W.abrirEditor = function (raiz, op) {
    op = op || {};
    const T = W.TERRENO, fin = new AbortController(), oye = { signal: fin.signal };
    raiz.classList.add('ed');
    raiz.innerHTML = `
      <div class="ed-top">
        <b>Editor de mapas</b>
        <input class="ed-nombre" placeholder="nombre del mapa" maxlength="40">
        <span class="ed-tam"></span>
        <button data-a="inicio">Nuevo o abrir</button>
        <button data-a="deshacer" title="Deshacer (Ctrl Z)">↶</button><button data-a="rehacer" title="Rehacer (Ctrl Mayús Z)">↷</button>
        <label class="ed-esp" title="Pinta también la celda opuesta (giro de 180°): mapa justo para los dos lados"><input type="checkbox" class="ed-espejo"> espejo</label>
        <span class="ed-sep"></span>
        <button data-a="guardar">Guardar</button><button data-a="exportar">Exportar .json</button><button data-a="probar" class="ed-fuerte">Probar</button>
        ${op.salir ? '<button data-a="salir">Salir</button>' : ''}
      </div>
      <div class="ed-cuerpo">
        <div class="ed-vista"><canvas class="ed-lienzo"></canvas><div class="ed-info"></div><div class="ed-aviso"></div></div>
        <div class="ed-panel">
          <div class="ed-herr"></div>
          <div class="ed-fila"><span>Pincel</span><input type="range" class="ed-pincel" min="1" max="25" value="5"><b class="ed-pincelV">5</b></div>
          <div class="ed-fila ed-cantF"><span>Cantidad</span><input type="range" class="ed-cant" min="150" max="2700" step="50" value="1350"><b class="ed-cantV">1350</b></div>
          <div class="ed-rev"></div>
          <div class="ed-ayuda">Clic: pintar o colocar · mover la vista: arrastrar con el botón derecho o con Espacio, o dos dedos en el trackpad · zoom: rueda o pellizco · M: la rueda mueve en vez de acercar · [ ]: pincel · Ctrl Z: deshacer</div>
        </div>
      </div>
      <div class="ed-inicio"></div>`;
    const $ = (s) => raiz.querySelector(s), lienzo = $('.ed-lienzo'), ctx = lienzo.getContext('2d'), vista = $('.ed-vista');
    let mp = null, herr = 'roca', img = null, capa = null, cctx = null, cam = { x: 0, y: 0, z: 2 }, rev = null, idMapa = '';
    const pila = [], rehacer = []; let trazo = null;
    const PAL = { 0: hex(C.llano), 1: hex(C.roca), 2: hex(C.agua), 3: hex(C.bosque), 4: hex(C.camino), 5: hex(C.agua) }, MIN = hex(C.mineral), RARO = hex(C.raro);

    // ---------- herramientas ----------
    $('.ed-herr').innerHTML = HERR.map(([g, L]) => `<div class="ed-grupo"><span>${g}</span><div>${L.map(([k, n]) => `<button data-h="${k}">${muestra(k)}${n}</button>`).join('')}</div></div>`).join('');
    function muestra(k) {
      const c = { llano: C.llano, roca: C.roca, agua: C.agua, bosque: C.bosque, mineral: C.mineral, raro: C.raro }[k];
      if (c) return `<i class="ed-m" style="background:${c}"></i>`;
      if (k === 'base0' || k === 'base1') return `<i class="ed-m" style="background:${k === 'base0' ? C.yo : C.rival}"></i>`;
      if (SITIO[k]) return `<i class="ed-m ed-redondo" style="border-color:${C.tinta}"></i>`;
      if (PUESTO[k]) return `<i class="ed-m ed-rombo"></i>`;
      return '<i class="ed-m ed-vacio"></i>';
    }
    const elegir = (k) => { herr = k; for (const b of raiz.querySelectorAll('[data-h]')) b.classList.toggle('on', b.dataset.h === k); $('.ed-cantF').style.opacity = k === 'mineral' || k === 'raro' ? 1 : 0.35; pintar(); };
    raiz.querySelector('.ed-herr').addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (b) elegir(b.dataset.h); });
    const pincel = () => +$('.ed-pincel').value, cant = () => +$('.ed-cant').value;
    $('.ed-pincel').addEventListener('input', () => { $('.ed-pincelV').textContent = pincel(); pintar(); });
    $('.ed-cant').addEventListener('input', () => { $('.ed-cantV').textContent = cant(); });
    const espejo = () => $('.ed-espejo').checked;
    $('.ed-espejo').addEventListener('change', () => { if (mp) mp.espejo = espejo(); pintar(); });
    $('.ed-nombre').addEventListener('input', () => { if (mp) mp.nombre = $('.ed-nombre').value.trim(); });

    // ---------- el mapa ----------
    function cargar(nuevo, id) {
      mp = nuevo; idMapa = id || ''; pila.length = 0; rehacer.length = 0;
      const N = mp.N; capa = document.createElement('canvas'); capa.width = capa.height = N; cctx = capa.getContext('2d'); img = cctx.createImageData(N, N);
      for (let i = 0; i < N * N; i++) pixel(i);
      cctx.putImageData(img, 0, 0);
      $('.ed-nombre').value = mp.nombre || ''; $('.ed-tam').textContent = N + ' × ' + N; $('.ed-espejo').checked = mp.espejo !== false;
      encajar(); revisar(); cerrarInicio();
    }
    function pixel(i) {
      const t = mp.terreno[i], q = mp.mineral[i], tm = mp.tipoMin[i];
      const c = q && tm ? mezcla(PAL[0], tm === 2 ? RARO : MIN, 0.45 + Math.min(1, q / 2700) * 0.5) : PAL[t];
      const k = i * 4; img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
    function encajar() {
      const r = vista.getBoundingClientRect(); lienzo.width = Math.max(1, Math.round(r.width * devicePixelRatio)); lienzo.height = Math.max(1, Math.round(r.height * devicePixelRatio));
      if (!mp) return; cam.z = Math.min(r.width, r.height) / mp.N * 0.96; cam.x = mp.N / 2; cam.y = mp.N / 2; pintar();
    }
    const aCelda = (px, py) => { const r = lienzo.getBoundingClientRect(); return { x: cam.x + (px - r.left - r.width / 2) / cam.z, y: cam.y + (py - r.top - r.height / 2) / cam.z }; };

    // ---------- dibujo ----------
    let raton = null;
    function pintar() {
      if (!mp) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, lienzo.width, lienzo.height); return; }
      const dpr = devicePixelRatio, w = lienzo.width / dpr, h = lienzo.height / dpr, z = cam.z, N = mp.N;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      const ox = w / 2 - cam.x * z, oy = h / 2 - cam.y * z, P = (x, y) => [ox + x * z, oy + y * z];
      ctx.imageSmoothingEnabled = false; ctx.drawImage(capa, ox, oy, N * z, N * z);
      ctx.strokeStyle = C.tinta; ctx.lineWidth = 1; ctx.strokeRect(ox - 0.5, oy - 0.5, N * z + 1, N * z + 1);
      if (rev) { ctx.fillStyle = C.mal; for (const L of rev.cuellos) for (const c of L) { const [x, y] = P(c % N, (c / N) | 0); ctx.fillRect(x, y, Math.max(1.5, z), Math.max(1.5, z)); } }
      const s = Math.max(10, z * 1.4);
      for (const p of mp.sitios) { const [x, y] = P(p.x + 0.5, p.y + 0.5); ctx.lineWidth = 1.5; ctx.strokeStyle = C.tinta; ctx.fillStyle = p.tipo === 'petroleo' ? C.tinta : '#ffffff'; ctx.beginPath(); ctx.arc(x, y, s * 0.5, 0, 7); ctx.fill(); ctx.stroke(); if (p.tipo === 'conocimiento') { ctx.fillStyle = C.tinta; ctx.beginPath(); ctx.arc(x, y, s * 0.17, 0, 7); ctx.fill(); } }
      for (const p of mp.puestos) { const [x, y] = P(p.x + 0.5, p.y + 0.5); ctx.fillStyle = '#ffffff'; ctx.strokeStyle = C.suave; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - s * 0.6); ctx.lineTo(x + s * 0.6, y); ctx.lineTo(x, y + s * 0.6); ctx.lineTo(x - s * 0.6, y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = C.suave; ctx.font = `${Math.max(8, s * 0.55)}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.tipo[0].toUpperCase(), x, y + 0.5); }
      mp.bases.forEach((b, j) => { const [x, y] = P(b.x - 1, b.y - 1), L = Math.max(14, 3 * z); const cx = x + 1.5 * z, cy = y + 1.5 * z; ctx.fillStyle = j ? C.rival : C.yo; ctx.fillRect(cx - L / 2, cy - L / 2, L, L); ctx.fillStyle = '#ffffff'; ctx.font = `bold ${Math.max(9, L * 0.6)}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(j + 1), cx, cy + 0.5); });
      if (raton && raton.dentro) {
        const c = aCelda(raton.x, raton.y), r = PINCEL[herr] ? (pincel() - 1) / 2 + 0.5 : 0.5, cx = Math.floor(c.x) + 0.5, cy = Math.floor(c.y) + 0.5;
        const anillo = (x0, y0, a) => { const [x, y] = P(x0, y0); ctx.globalAlpha = a; ctx.strokeStyle = C.tinta; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, Math.max(3, r * z), 0, 7); ctx.stroke(); ctx.globalAlpha = 1; };
        anillo(cx, cy, 0.9); if (espejo() && herr !== 'base0' && herr !== 'base1') anillo(N - cx, N - cy, 0.4);
      }
    }

    // ---------- acciones con deshacer ----------
    const listas = () => JSON.stringify({ sitios: mp.sitios, puestos: mp.puestos, bases: mp.bases });
    function empezar() { trazo = { cel: new Map(), antes: listas() }; }
    function celda(i, t, q, tm) {
      if (i < 0 || i >= mp.N * mp.N) return;
      if (mp.terreno[i] === t && mp.mineral[i] === q && mp.tipoMin[i] === tm) return;
      if (!trazo.cel.has(i)) trazo.cel.set(i, [mp.terreno[i], mp.mineral[i], mp.tipoMin[i]]);
      mp.terreno[i] = t; mp.mineral[i] = q; mp.tipoMin[i] = tm; pixel(i); sucio = true;
    }
    let sucio = false;
    function terminar() {
      if (!trazo) return; const despues = listas();
      if (trazo.cel.size || despues !== trazo.antes) { const nue = new Map(); for (const i of trazo.cel.keys()) nue.set(i, [mp.terreno[i], mp.mineral[i], mp.tipoMin[i]]); pila.push({ cel: trazo.cel, nue, antes: trazo.antes, despues }); if (pila.length > 60) pila.shift(); rehacer.length = 0; }
      trazo = null; volcar(); revisar();
    }
    function aplicarPaso(cel, L) { for (const [i, v] of cel) { mp.terreno[i] = v[0]; mp.mineral[i] = v[1]; mp.tipoMin[i] = v[2]; pixel(i); } Object.assign(mp, JSON.parse(L)); sucio = true; volcar(); revisar(); }
    function deshacer() { const p = pila.pop(); if (!p) return; rehacer.push(p); aplicarPaso(p.cel, p.antes); }
    function rehacerUno() { const p = rehacer.pop(); if (!p) return; pila.push(p); aplicarPaso(p.nue, p.despues); }
    function volcar() { if (sucio) { cctx.putImageData(img, 0, 0); sucio = false; } pintar(); }

    // pincel redondo, con su espejo
    function brocha(x, y) {
      const N = mp.N, r = (pincel() - 1) / 2, R = Math.ceil(r), cx = Math.floor(x), cy = Math.floor(y);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > (r + 0.35) * (r + 0.35)) continue; const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        const i = yy * N + xx; poner(i); if (espejo()) poner(W.espejoDe(N, i));
      }
    }
    const esSitio = (i) => mp.sitios.some((s) => s.y * mp.N + s.x === i) || mp.puestos.some((s) => s.y * mp.N + s.x === i);
    function poner(i) {
      const t = mp.terreno[i];
      if (herr === 'llano' || herr === 'roca' || herr === 'agua' || herr === 'bosque') { const v = T[{ llano: 'LLANO', roca: 'ROCA', agua: 'AGUA', bosque: 'BOSQUE' }[herr]]; celda(i, v, v === T.LLANO ? mp.mineral[i] : 0, v === T.LLANO ? mp.tipoMin[i] : 0); }
      else if (herr === 'mineral' || herr === 'raro') { if (t === T.LLANO && !esSitio(i)) celda(i, t, cant(), herr === 'raro' ? 2 : 1); }
      else if (herr === 'sinRecurso') celda(i, t, 0, 0);
    }
    function colocar(x, y) {
      const N = mp.N, cx = Math.floor(x), cy = Math.floor(y); if (cx < 0 || cy < 0 || cx >= N || cy >= N) return; const i = cy * N + cx, ie = W.espejoDe(N, i);
      if (herr === 'base0' || herr === 'base1') {
        const j = herr === 'base0' ? 0 : 1, a = Math.max(1, Math.min(N - 2, cx)), b = Math.max(1, Math.min(N - 2, cy));
        mp.bases[j] = { x: a, y: b }; if (espejo()) mp.bases[1 - j] = { x: N - 1 - a, y: N - 1 - b };
        for (const bb of espejo() ? mp.bases : [mp.bases[j]]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) celda((bb.y + dy) * N + bb.x + dx, T.LLANO, 0, 0); // el sitio del patio, despejado
        return;
      }
      const quitar = (k) => { const fx = k % N, fy = (k / N) | 0, lejos = (p) => Math.hypot(p.x - fx, p.y - fy) > 1.5; mp.sitios = mp.sitios.filter(lejos); mp.puestos = mp.puestos.filter(lejos); };
      if (herr === 'quitarSitio') { quitar(i); if (espejo()) quitar(ie); return; }
      if (!SITIO[herr] && !PUESTO[herr]) return;
      if (mp.terreno[i] !== T.LLANO) { avisar('Los sitios y puestos van sobre llano'); return; }
      const lista = () => (SITIO[herr] ? mp.sitios : mp.puestos); // (después de quitar: quitar cambia las listas)
      quitar(i); lista().push({ x: cx, y: cy, tipo: herr }); celda(i, T.LLANO, 0, 0);
      if (espejo() && ie !== i) { quitar(ie); lista().push({ x: N - 1 - cx, y: N - 1 - cy, tipo: herr }); celda(ie, T.LLANO, 0, 0); }
    }
    let tAviso = 0; function avisar(t) { const a = $('.ed-aviso'); a.textContent = t; a.style.opacity = 1; clearTimeout(tAviso); tAviso = setTimeout(() => { a.style.opacity = 0; }, 2200); }

    // ---------- revisión ----------
    function revisar() {
      if (!mp) return; W.completarMapa(mp); rev = W.revisarMapa(mp);
      const e = rev.entradas.map((n, j) => `<span style="color:${j ? C.rival : C.yo}">■</span> base ${j + 1}: ${n === 0 ? 'sin salida' : n === 1 ? '<b style="color:' + C.mal + '">una sola entrada</b> (el cuello, en rojo)' : 'dos o más entradas'}`).join('<br>');
      const avs = rev.avisos.filter((x) => !/entrada|salida/.test(x)); // las entradas ya van arriba, base por base
      $('.ed-rev').innerHTML = `<div class="ed-revT">Revisión</div>${e}` +
        (rev.errores.length ? `<ul class="ed-err">${rev.errores.map((x) => `<li>${x}</li>`).join('')}</ul>` : '') +
        (avs.length ? `<ul class="ed-av">${avs.map((x) => `<li>${x}</li>`).join('')}</ul>` : '') +
        (!rev.errores.length && !avs.length && rev.entradas.every((n) => n >= 2) ? '<div class="ed-ok">Todo en orden</div>' : '');
      $('[data-a="probar"]').disabled = rev.errores.length > 0; pintar();
    }

    // ---------- ratón, táctil y teclado ----------
    const dedos = new Map(); let arrastre = null, espacio = false, pinta = false, ultimo = null;
    lienzo.addEventListener('contextmenu', (e) => e.preventDefault());
    lienzo.addEventListener('pointerdown', (e) => {
      if (!mp) return; lienzo.setPointerCapture(e.pointerId); dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (dedos.size === 2) { if (pinta) { pinta = false; terminar(); } arrastre = { gesto: true, ...gesto() }; return; }
      if (e.button === 2 || e.button === 1 || espacio) { arrastre = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }; return; }
      const c = aCelda(e.clientX, e.clientY); empezar();
      if (PINCEL[herr]) { pinta = true; ultimo = c; brocha(c.x, c.y); volcar(); } else { colocar(c.x, c.y); terminar(); }
    });
    function gesto() { const [a, b] = [...dedos.values()]; return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: cam.x, cy: cam.y, z: cam.z }; }
    lienzo.addEventListener('pointermove', (e) => {
      raton = { x: e.clientX, y: e.clientY, dentro: true };
      if (dedos.has(e.pointerId)) dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mp) { const c = aCelda(e.clientX, e.clientY), N = mp.N, x = Math.floor(c.x), y = Math.floor(c.y); if (x >= 0 && y >= 0 && x < N && y < N) { const i = y * N + x, t = mp.terreno[i]; $('.ed-info').textContent = `${x}, ${y} · ${['llano', 'roca', 'agua', 'bosque', 'camino', 'puente'][t]}${mp.mineral[i] ? ' · ' + (mp.tipoMin[i] === 2 ? 'raro ' : 'mineral ') + mp.mineral[i] : ''}`; } }
      if (arrastre && arrastre.gesto && dedos.size === 2) { const g = gesto(), f = g.d / arrastre.d; cam.z = Math.max(0.3, Math.min(40, arrastre.z * f)); cam.x = arrastre.cx - (g.mx - arrastre.mx) / cam.z; cam.y = arrastre.cy - (g.my - arrastre.my) / cam.z; acotar(); pintar(); return; }
      if (arrastre && !arrastre.gesto) { cam.x = arrastre.cx - (e.clientX - arrastre.x) / cam.z; cam.y = arrastre.cy - (e.clientY - arrastre.y) / cam.z; acotar(); pintar(); return; }
      if (pinta) { const c = aCelda(e.clientX, e.clientY), d = Math.hypot(c.x - ultimo.x, c.y - ultimo.y), n = Math.max(1, Math.ceil(d / Math.max(0.5, pincel() / 3))); for (let k = 1; k <= n; k++) brocha(ultimo.x + (c.x - ultimo.x) * k / n, ultimo.y + (c.y - ultimo.y) * k / n); ultimo = c; volcar(); return; }
      pintar();
    });
    const soltar = (e) => { dedos.delete(e.pointerId); if (pinta) { pinta = false; terminar(); } if (!dedos.size) arrastre = null; };
    lienzo.addEventListener('pointerup', soltar); lienzo.addEventListener('pointercancel', soltar);
    lienzo.addEventListener('pointerleave', () => { if (raton) raton.dentro = false; pintar(); });
    // Como en el juego: la rueda del ratón acerca y aleja; en el trackpad, dos dedos mueven la vista y el pellizco acerca.
    // El trackpad se reconoce porque también desliza en horizontal; la tecla M cambia el modo a mano.
    const acotar = () => { cam.x = Math.max(0, Math.min(mp.N, cam.x)); cam.y = Math.max(0, Math.min(mp.N, cam.y)); };
    const zoomEn = (px, py, f) => { const a = aCelda(px, py); cam.z = Math.max(0.3, Math.min(40, cam.z * f)); const b = aCelda(px, py); cam.x += a.x - b.x; cam.y += a.y - b.y; acotar(); pintar(); };
    let deslizar = false, escalaGesto = 1;
    lienzo.addEventListener('wheel', (e) => {
      if (!mp) return; e.preventDefault(); const u = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) { zoomEn(e.clientX, e.clientY, Math.exp(-Math.max(-30, Math.min(30, e.deltaY * u)) * 0.01)); return; } // pellizco (Chrome, Firefox)
      if (e.deltaX !== 0) deslizar = true;
      if (deslizar) { cam.x += (e.deltaX * u) / cam.z; cam.y += (e.deltaY * u) / cam.z; acotar(); pintar(); }
      else zoomEn(e.clientX, e.clientY, Math.exp(-e.deltaY * u * 0.0015));
    }, { passive: false });
    lienzo.addEventListener('gesturestart', (e) => { e.preventDefault(); escalaGesto = 1; }); // pellizco en Safari
    lienzo.addEventListener('gesturechange', (e) => { e.preventDefault(); if (mp && e.scale > 0) { const r = lienzo.getBoundingClientRect(); zoomEn(r.left + r.width / 2, r.top + r.height / 2, e.scale / escalaGesto); escalaGesto = e.scale; } });
    lienzo.addEventListener('gestureend', (e) => e.preventDefault());
    const tecla = (e) => {
      if (!raiz.isConnected || e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
      if (e.code === 'Space') { espacio = e.type === 'keydown'; e.preventDefault(); return; }
      if (e.type !== 'keydown') return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) rehacerUno(); else deshacer(); return; }
      if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey) { deslizar = !deslizar; avisar(deslizar ? 'La rueda mueve la vista (M para volver al zoom)' : 'La rueda acerca y aleja (M para mover la vista)'); return; }
      if (e.key === '[' || e.key === ']') { const p = $('.ed-pincel'); p.value = Math.max(1, Math.min(25, +p.value + (e.key === ']' ? 2 : -2))); p.dispatchEvent(new Event('input')); }
    };
    addEventListener('keydown', tecla, oye); addEventListener('keyup', tecla, oye);
    addEventListener('resize', () => { if (!raiz.isConnected) return; const z = cam.z; encajar(); if (mp) cam.z = z; pintar(); }, oye);

    // ---------- barra de arriba ----------
    raiz.querySelector('.ed-top').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
      if (a === 'inicio') abrirInicio();
      else if (a === 'deshacer') deshacer();
      else if (a === 'rehacer') rehacerUno();
      else if (a === 'salir' && op.salir) op.salir();
      else if (!mp) return;
      else if (a === 'guardar') { if (guardar()) avisar('Guardado en este navegador'); }
      else if (a === 'exportar') { const json = W.mapaAJSON(mp), url = URL.createObjectURL(new Blob([JSON.stringify(json)], { type: 'application/json' })), el = document.createElement('a'); el.href = url; el.download = (json.nombre || 'mapa').replace(/[^\wáéíóúñ -]+/gi, '').trim().replace(/\s+/g, '-') + '.rts-mapa.json'; el.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      else if (a === 'probar') { if (rev && rev.errores.length) { avisar('Antes, corrige los errores de la revisión'); return; } if (!op.probar) { avisar('En el juego, esto abre una partida con este mapa'); return; } if (guardar()) op.probar(W.mapaAJSON(mp), idMapa); } // se guarda antes: la partida lo lee de «mis mapas»
    });
    function guardar() {
      const json = W.mapaAJSON(mp); if (!json.nombre) { json.nombre = mp.nombre = 'mapa ' + new Date().toLocaleString('es'); $('.ed-nombre').value = mp.nombre; }
      idMapa = idMapa || 'm' + Date.now().toString(36);
      try { W.guardarMiMapa(idMapa, json); return true; } catch (err) { avisar('No cabe en la memoria del navegador: exporta el .json'); return false; }
    }

    // ---------- cómo se empieza ----------
    function abrirInicio() {
      const L = W.misMapas(), ids = Object.keys(L).sort((a, b) => (L[b].fecha || '').localeCompare(L[a].fecha || ''));
      const tipos = Object.keys(W.MAPAS).map((k) => `<option value="${k}">${W.MAPAS[k].nombre}</option>`).join('');
      const tam = (n) => `<select class="ed-i-${n}">${[128, 256, 512, 1024].map((v) => `<option ${v === 256 ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
      const ini = $('.ed-inicio');
      ini.innerHTML = `<div class="ed-caja">
        <div class="ed-cajaT">¿Cómo empiezas?${mp ? '<button data-i="cerrar" class="ed-x">×</button>' : ''}</div>
        <div class="ed-opc"><b>De cero</b>
          <label>Tamaño ${tam('n')}</label>
          <label>Empieza todo <select class="ed-i-rel"><option value="llano">llano</option><option value="roca">roca (y vas abriendo)</option></select></label>
          <label class="ed-chk"><input type="radio" name="ed-esp" value="si" checked> en espejo (justo para los dos)</label>
          <label class="ed-chk"><input type="radio" name="ed-esp" value="no"> libre (cada lado a mano)</label>
          <button data-i="cero" class="ed-fuerte">Empezar</button></div>
        <div class="ed-opc"><b>A partir de un mapa del juego</b>
          <label>Tipo <select class="ed-i-tipo">${tipos}</select></label>
          <label>Semilla <input class="ed-i-sem" value="${Math.floor(Math.random() * 1e6)}" size="9"></label>
          <label>Tamaño ${tam('n2')}</label>
          <button data-i="generar" class="ed-fuerte">Editar este</button></div>
        <div class="ed-opc"><b>Uno mío</b>
          <div class="ed-lista">${ids.length ? ids.map((id) => `<div class="ed-li"><button data-i="abrir" data-id="${id}">${(L[id].nombre || id).replace(/</g, '&lt;')} <small>${L[id].N} · ${(L[id].fecha || '').slice(0, 10)}</small></button><button data-i="borrar" data-id="${id}" title="Borrar">×</button></div>`).join('') : '<small>Aún no hay mapas guardados en este navegador.</small>'}</div>
          <label class="ed-archivo">Abrir un archivo .json<input type="file" accept=".json,application/json" class="ed-i-arch"></label></div>
      </div>`;
      ini.style.display = 'flex';
      ini.querySelector('.ed-i-arch').addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; f.text().then((txt) => { try { cargar(W.mapaDeJSON(txt)); } catch (err) { avisar('No se pudo abrir: ' + err.message); } }); });
    }
    function cerrarInicio() { $('.ed-inicio').style.display = 'none'; }
    $('.ed-inicio').addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return; const a = b.dataset.i, v = (s) => $('.ed-inicio ' + s).value;
      if (a === 'cerrar') cerrarInicio();
      else if (a === 'cero') { const esp = raiz.querySelector('[name="ed-esp"]:checked').value === 'si'; cargar(W.mapaVacio(+v('.ed-i-n'), v('.ed-i-rel'), esp)); }
      else if (a === 'generar') { const tipo = v('.ed-i-tipo'), sem = (+v('.ed-i-sem') | 0) || 1, g = W.generarMapa(sem, +v('.ed-i-n2'), tipo); g.tipo = 'propio'; g.espejo = true; g.nombre = W.MAPAS[tipo].nombre + ' ' + sem; cargar(g); }
      else if (a === 'abrir') { const L = W.misMapas(), q = L[b.dataset.id]; try { cargar(W.mapaDeJSON(q.mapa), b.dataset.id); } catch (err) { avisar('No se pudo abrir: ' + err.message); } }
      else if (a === 'borrar') { if (confirm('¿Borrar este mapa del navegador?')) { W.borrarMiMapa(b.dataset.id); abrirInicio(); } }
    });

    elegir('roca');
    requestAnimationFrame(() => { encajar(); const L = W.misMapas(); if (op.abrir && L[op.abrir]) { try { cargar(W.mapaDeJSON(L[op.abrir].mapa), op.abrir); return; } catch (err) { avisar('No se pudo abrir: ' + err.message); } } abrirInicio(); });
    return { cargar, mapa: () => mp, cerrar: () => { fin.abort(); raiz.innerHTML = ''; raiz.classList.remove('ed'); } };
  };
})();
