/* MicoHunter — QUINTO estilo: «Observatorio» (studio.js)  v1.02
   ============================================================================
   Capa de presentación INDEPENDIENTE que se activa/desactiva con un botón,
   sin recargar la página y sin tocar el motor de predicción ni los cuatro
   temas existentes.

   Qué hace este archivo (y qué NO hace):
     · Alterna el atributo html[data-mhstudio="on"], que es lo único que
       activa studio.css (con el estilo apagado no afecta a nada).
     · Reordena NODOS REALES ya existentes (menú, buscador, tarjetas…) para
       componer la nueva interfaz. Los id no cambian, así que app.js sigue
       funcionando exactamente igual.
     · Añade componentes de SOLO presentación, derivados de datos que el
       motor ya ha pintado: la franja de contexto, el medidor de potencial y
       dos estadísticas bajo el mapa (índice por especie y evolución de la
       lluvia). No calcula, no inventa cifras: copia lo que ya está en el DOM
       y, cuando falta el dato, muestra un estado vacío.
     · Guarda la preferencia en su propia clave (mh-studio), sin sobrescribir
       «mh-theme» ni ninguna otra preferencia.
   Al desactivarse restaura el orden del DOM y vuelve a encender el tema que
   el usuario tenía seleccionado.
   ========================================================================== */
(function () {
  "use strict";

  var KEY = "mh-studio";
  var THEME_LINKS = { dark: "themeDark", musgo: "themeMusgo", nature: "themeNature" };
  var THEMES = ["light", "dark", "musgo", "nature"];
  var ROOT = document.documentElement;

  var on = false, built = false;
  var moved = [], created = [];
  var dom = {};
  var toggleBtn = null;                              // vive fuera de `dom`: teardown() vacía `dom`
  var obs = null, attrObs = null, raf = 0;

  function byId(id) { return document.getElementById(id); }
  var onceDone = [];
  function rec(n) { if (n && n.parentNode) moved.push({ n: n, p: n.parentNode, s: n.nextSibling }); return n; }
  function move(n, parent) { rec(n); parent.appendChild(n); return n; }
  /* Mueve un nodo registrando su sitio original solo la primera vez
     (para poder reubicarlo en distintos puntos de ruptura sin perderlo). */
  function moveOnce(n, parent, before) {
    if (onceDone.indexOf(n) < 0) { rec(n); onceDone.push(n); }
    if (before && before.parentNode === parent) parent.insertBefore(n, before);
    else parent.appendChild(n);
    return n;
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    created.push(e);
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* Primer número de un texto ya pintado por el motor ("52 L/m²" → 52).
     Devuelve null cuando no hay dato ("—"): eso NO es un cero. */
  function num(t) {
    var m = String(t == null ? "" : t).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  /* ── Tema: al entrar en el observatorio se silencian las hojas de tema
        para que no interfieran; al salir se devuelve la que tocaba. ────── */
  function themeNow() {
    var t = "musgo";
    try { t = localStorage.getItem("mh-theme") || "musgo"; } catch (e) {}
    if (t === "guia" || t === "movil") t = "musgo";
    if (THEMES.indexOf(t) < 0) t = "musgo";
    return t;
  }
  function applyTheme() {
    var t = themeNow();
    for (var k in THEME_LINKS) {
      if (!Object.prototype.hasOwnProperty.call(THEME_LINKS, k)) continue;
      var l = byId(THEME_LINKS[k]);
      if (l) l.disabled = (on || k !== t);
    }
  }

  /* ── Botón de alternancia ────────────────────────────────────────────── */
  /* Se monta UNA sola vez, al cargar y SIEMPRE (no al entrar), y no se
     registra en `created`: teardown() borra los nodos temporales y la puerta
     de entrada debe sobrevivir tanto al arranque en frío como a la salida. */
  function mountToggle() {
    if (toggleBtn && toggleBtn.parentNode) { updateToggle(); return true; }
    var headerInner = document.querySelector(".header-inner");
    if (!headerInner) return false;
    var b = document.createElement("button");
    b.className = "st-toggle";
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", "Activar la interfaz Observatorio");
    b.title = "Interfaz «Observatorio»: composición alternativa de la misma app";
    b.innerHTML = '<span class="st-toggle-ico" aria-hidden="true">🔭</span>' +
                  '<span class="st-toggle-txt">Observatorio</span>';
    b.addEventListener("click", function () { toggle(); });
    toggleBtn = b;
    headerInner.appendChild(b);
    updateToggle();
    return true;
  }
  function updateToggle() {
    var b = toggleBtn;
    if (!b) return;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", on ? "Salir del observatorio y volver a la interfaz anterior"
                                    : "Activar la interfaz Observatorio");
    var t = b.querySelector(".st-toggle-txt");
    if (t) t.textContent = on ? "Salir" : "Observatorio";
    b.title = on ? "Volver a la interfaz y al tema anteriores"
                 : "Interfaz «Observatorio»: composición alternativa de la misma app";
  }

  /* ── Componentes derivados (solo presentación) ───────────────────────── */
  function pill(ico, id, label) {
    return '<div class="st-pill"><span class="st-pill-ico" aria-hidden="true">' + ico +
           '</span><span class="st-pill-lbl">' + label + '</span><b data-st-mirror="' + id + '">—</b></div>';
  }

  function buildContext() {
    var ctx = el("div", "st-ctx");
    ctx.setAttribute("aria-label", "Contexto del punto analizado");
    ctx.innerHTML =
      '<h1 class="st-ctx-place">' +
        '<span class="st-ctx-pin" aria-hidden="true">📍</span>' +
        '<span class="st-ctx-name" data-st-mirror="locationName">—</span>' +
        '<small class="st-ctx-coords" data-st-mirror="coordinatesValue">—</small>' +
      '</h1>' +
      '<div class="st-ctx-pills">' +
        pill("⛰️", "altitudeValue", "Altitud") +
        pill("🌡️", "airNowValue", "Temp aire") +
        pill("🌧️", "rain14Value", "Lluvia 14 d") +
        pill("💧", "rain30Value", "Reserva 30 d") +
        pill("⚗️", "phValue", "pH") +
      '</div>';
    return ctx;
  }

  function buildHero() {
    var hero = el("div", "st-hero");
    hero.innerHTML =
      '<div class="st-gauge">' +
        '<svg viewBox="0 0 100 100" aria-hidden="true">' +
          '<circle class="st-gauge-bg" cx="50" cy="50" r="44"></circle>' +
          '<circle class="st-gauge-fill" id="stGaugeFill" cx="50" cy="50" r="44"></circle>' +
        '</svg>' +
        '<div class="st-gauge-val">' +
          '<span class="st-gauge-num" id="stGaugeNum">—</span>' +
          '<span class="st-gauge-unit">/100</span>' +
          '<span class="st-gauge-lbl" id="stGaugeLbl">potencial</span>' +
        '</div>' +
      '</div>' +
      '<div class="st-hero-info">' +
        '<div class="st-hero-title">Mayor potencial entre las especies activas</div>' +
        '<p class="st-hero-species" id="stHeroSpecies">Pulsa el mapa para analizar un punto.</p>' +
        '<p class="st-hero-banner" id="stHeroBanner"></p>' +
        '<div class="st-hero-pills">' +
          '<span class="st-pill">📊 Media activas: <b id="stHeroAvg">—</b></span>' +
          '<span class="st-pill">🍄 Con dato: <b id="stHeroCount">—</b></span>' +
          '<span class="st-pill">🕒 <b data-st-mirror="lastUpdate">—</b></span>' +
        '</div>' +
        '<p class="st-hero-note">Vista derivada de los índices que ya ha calculado el motor; no es un dato nuevo.</p>' +
      '</div>';
    dom.hero = hero;
    return hero;
  }

  function resolveHeroRefs() {
    dom.gaugeFill = byId("stGaugeFill");
    dom.gaugeNum = byId("stGaugeNum");
    dom.gaugeLbl = byId("stGaugeLbl");
    dom.species = byId("stHeroSpecies");
    dom.banner = byId("stHeroBanner");
    dom.avg = byId("stHeroAvg");
    dom.count = byId("stHeroCount");
  }

  /* ── Construcción del armazón ────────────────────────────────────────── */
  function build() {
    if (built) return;
    built = true;

    var header = document.querySelector(".header");
    var headerInner = document.querySelector(".header-inner");
    var menuPanel = byId("menuPanel");
    var grid = document.querySelector("#dashboard .dashboard-grid") || document.querySelector(".dashboard-grid");
    var mapCard = document.querySelector("#dashboard .map-card") || document.querySelector(".map-card");
    var search = document.querySelector("#dashboard .search-row") || document.querySelector(".search-row");
    var results = byId("results");
    var fav = byId("favSelect");
    var mush = byId("mushroomCards");

    /* 1 · Barra superior: buscador real + salto + botón */
    var tools = el("div", "st-tools");
    if (search && results) {
      var sw = el("div", "st-search");
      move(search, sw);
      move(results, sw);
      tools.appendChild(sw);
    }
    if (fav) moveOnce(fav, tools);
    if (headerInner) headerInner.appendChild(tools);
    dom.tools = tools;
    dom.mapCard = mapCard;
    dom.fav = fav;
    /* El botón no se crea aquí: se monta al cargar y solo se reubica (así
       sigue existiendo al salir). moveOnce lo devuelve a la cabecera. */
    mountToggle();
    if (toggleBtn && toggleBtn.parentNode !== tools) moveOnce(toggleBtn, tools);
    placeFav();

    /* 2 · Barra lateral: el menú real, reordenado. Se conserva el botón ☰
           (que ya sabe abrir/cerrar el panel) para el cajón en móvil. */
    var aside = el("aside", "st-sidebar");
    aside.id = "studioSidebar";
    var inner = el("div", "st-sidebar-inner");
    aside.appendChild(inner);
    dom.aside = aside;
    dom.panel = menuPanel;
    if (header && header.parentNode) header.parentNode.insertBefore(aside, header.nextSibling);
    if (menuPanel) {
      move(menuPanel, inner);
      var labels = [["dashboard", "Análisis"], ["especie", "Exploración"], ["metodologia", "Conocimiento"]];
      for (var i = 0; i < labels.length; i++) {
        var b = menuPanel.querySelector('.nav-btn[data-section="' + labels[i][0] + '"]');
        if (b && b.parentNode) b.parentNode.insertBefore(el("div", "st-navsec", labels[i][1]), b);
      }
      menuPanel.hidden = window.innerWidth <= 1024;
    }

    /* 3 · Franja de contexto + medidor de potencial, delante del mapa */
    if (grid && mapCard) {
      var ctx = buildContext();
      grid.insertBefore(ctx, mapCard);
      var hero = buildHero();
      grid.insertBefore(hero, mapCard);
      resolveHeroRefs();
      dom.ctx = ctx;
    }

    /* 4 · Dos paneles de estadística, a todo el ancho, bajo la fila del mapa */
    if (mush && mush.parentNode) {
      dom.statsSp = buildStatsSpecies();
      mush.parentNode.insertBefore(dom.statsSp, mush);
      dom.statsRain = buildStatsRain();
      mush.parentNode.insertBefore(dom.statsRain, mush);
      resolveStatsRefs();
    }
  }

  /* ── Sincronización de los componentes derivados ─────────────────────── */
  function refreshMirrors() {
    var list = document.querySelectorAll("[data-st-mirror]");
    for (var i = 0; i < list.length; i++) {
      var t = list[i], src = byId(t.getAttribute("data-st-mirror"));
      var v = src ? (src.textContent || "").trim() : "";
      if (!v) v = "—";
      if (t.textContent !== v) t.textContent = v;
    }
  }

  function refreshHero() {
    if (!built || !dom.hero) return;
    var cards = document.querySelectorAll("#mushroomCards .mushroom-card");
    var n = 0, sum = 0, best = null, bestV = -1;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.style.display === "none") continue;
      var p = c.querySelector(".percentage");
      if (!p) continue;
      var v = parseFloat((p.textContent || "").replace(",", "."));
      if (isNaN(v)) continue;
      n++; sum += v;
      if (v > bestV) { bestV = v; best = c; }
    }
    var C = 2 * Math.PI * 44;
    if (!n) {
      if (dom.gaugeNum) dom.gaugeNum.textContent = "—";
      if (dom.gaugeLbl) dom.gaugeLbl.textContent = "potencial";
      if (dom.gaugeFill) dom.gaugeFill.style.strokeDasharray = "0 " + C.toFixed(1);
      if (dom.species) dom.species.textContent = "Pulsa el mapa para analizar un punto.";
      if (dom.banner) dom.banner.textContent = "";
      if (dom.avg) dom.avg.textContent = "—";
      if (dom.count) dom.count.textContent = "—";
      return;
    }
    var c2 = Math.round(bestV * 10) / 10;
    var nivel = bestV < 25 ? "nulo" : bestV < 50 ? "regular" : bestV < 75 ? "bueno" : "excelente";
    if (dom.gaugeNum) dom.gaugeNum.textContent = String(c2);
    if (dom.gaugeLbl) dom.gaugeLbl.textContent = nivel;
    if (dom.gaugeFill) dom.gaugeFill.style.strokeDasharray = (bestV / 100 * C).toFixed(1) + " " + C.toFixed(1);
    if (dom.avg) dom.avg.textContent = (Math.round(sum / n * 10) / 10) + "";
    if (dom.count) dom.count.textContent = n + " / " + cards.length;
    var name = best.querySelector(".mushroom-name");
    var ban = best.querySelector(".prediction-text");
    if (dom.species) dom.species.textContent = name ? name.textContent : "";
    if (dom.banner) dom.banner.textContent = ban ? ban.textContent : "";
  }

  /* ── Estadísticas de fructificación (solo presentación) ──────────────────
     Dos paneles bajo la fila del mapa, construidos con datos que el motor YA
     ha pintado en el DOM. No se calcula ningún índice nuevo ni se inventan
     cifras: si falta el dato, se muestra un estado vacío.
       · Panel 1 → índice de potencial por especie (.percentage + nivel) y
                   reparto por niveles.
       · Panel 2 → lluvia diaria de la tabla de Meteorología (#metObsBody /
                   #metFcBody, que se rellena en cada cálculo) y el valor REAL
                   de la ventana hídrica con su objetivo, leídos de la propia
                   fila de condiciones de la especie con mayor índice.
     ─────────────────────────────────────────────────────────────────────── */

  var NIVELLBL = { nulo: "Nulo", regular: "Regular", bueno: "Bueno", excelente: "Excelente" };
  /* Umbrales del propio motor (app.js): <25 nulo, <50 regular, <75 bueno. */
  function nivelDe(v) { return v < 25 ? "nulo" : v < 50 ? "regular" : v < 75 ? "bueno" : "excelente"; }

  /* Tarjetas de especie visibles, ordenadas por índice (mismo criterio que
     el medidor del hero). */
  function readSpecies() {
    var out = [], cards = document.querySelectorAll("#mushroomCards .mushroom-card");
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.style.display === "none") continue;
      var p = c.querySelector(".percentage");
      if (!p) continue;
      var v = num(p.textContent);
      if (v == null) continue;
      var lvEl = c.querySelector('[id^="ringNivel"]');
      var lv = lvEl ? (lvEl.textContent || "").trim().toLowerCase() : "";
      if (NIVELLBL[lv] == null) lv = nivelDe(v);
      out.push({
        card: c, v: v, lvl: lv,
        name: (c.querySelector(".mushroom-name") || {}).textContent || "",
        sci: (c.querySelector(".mushroom-scientific") || {}).textContent || ""
      });
    }
    out.sort(function (a, b) { return b.v - a.v; });
    return out;
  }

  /* Objetivo y valor reales de la fila «Lluvia 14 días» de una tarjeta. */
  function rainCondition(card) {
    if (!card) return null;
    var items = card.querySelectorAll('[id^="condList"] .condition-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].textContent.indexOf("Lluvia 14") < 0) continue;
      var tg = items[i].querySelector(".target");
      var cv = items[i].querySelector(".condition-value");
      var o = tg ? String(tg.textContent).match(/(\d+)\s*[–-]\s*(\d+)/) : null;
      var est = "lv-mid";
      if (cv && cv.classList) {
        est = cv.classList.contains("lv-ok") ? "lv-ok"
            : cv.classList.contains("lv-bad") ? "lv-bad" : "lv-mid";
      }
      return { obj: o ? [parseInt(o[1], 10), parseInt(o[2], 10)] : null, val: num(cv ? cv.textContent : ""), est: est };
    }
    return null;
  }

  /* Lluvia diaria de las tablas de Meteorología. El orden real se deduce del
     acumulado (el mayor es el día más reciente), sin depender del formato de
     fecha ni del cambio de año. */
  function readRain() {
    var obs = [], i, rows = document.querySelectorAll("#metObsBody tr");
    for (i = 0; i < rows.length; i++) {
      var td = rows[i].children;
      if (td.length < 4) continue;
      obs.push({ d: (td[0].textContent || "").trim(), mm: num(td[1].textContent), ac: num(td[3].textContent) });
    }
    if (obs.length > 1) {
      var a = obs[0].ac, b = obs[obs.length - 1].ac, inv;
      if (a != null && b != null && a !== b) inv = a > b;
      else {
        var key = function (s) { var m = String(s).match(/(\d+)\s*\/\s*(\d+)/); return m ? (+m[2]) * 100 + (+m[1]) : 0; };
        inv = key(obs[0].d) > key(obs[obs.length - 1].d);   // empate (todo a 0): se usa la fecha
      }
      if (inv) obs.reverse();                               // venía de más reciente a más antiguo
    }
    var fc = [], frows = document.querySelectorAll("#metFcBody tr");
    for (i = 0; i < frows.length; i++) {
      var tf = frows[i].children;
      if (tf.length < 3) continue;
      fc.push({ d: (tf[0].textContent || "").trim(), mm: num(tf[2].textContent), ac: null });
    }
    return { obs: obs, fc: fc };
  }

  /* Número corto para ejes y rótulos (misma convención que el motor: punto) */
  function n1(v) { return String(Math.round(v * 10) / 10); }

  function buildStatsSpecies() {
    var p = el("div", "card st-panel st-panel-sp");
    p.id = "stStatsSpecies";
    p.innerHTML =
      '<div class="st-panel-head">' +
        '<h2>📊 Estadística de fructificación</h2>' +
        '<p class="st-panel-sub">Índice de potencial del motor (0–100) de cada especie activa, ordenado de mayor a menor.</p>' +
      '</div>' +
      '<div class="st-sp-rows" id="stSpRows"></div>' +
      '<div class="st-sp-reparto" id="stSpReparto"></div>' +
      '<p class="st-panel-note">Vista derivada de los índices que ya ha calculado el motor; no es un dato nuevo.</p>';
    return p;
  }

  function buildStatsRain() {
    var p = el("div", "card st-panel st-panel-rain");
    p.id = "stStatsRain";
    p.innerHTML =
      '<div class="st-panel-head">' +
        '<h2>🌧️ Evolución de la lluvia</h2>' +
        '<p class="st-panel-sub">Hasta 30 días observados y 7 de previsión del punto analizado. La franja marca los 14 días que usa el motor.</p>' +
      '</div>' +
      '<div class="st-rain-wrap">' +
        '<div class="st-rain-yaxis" id="stRainY" aria-hidden="true"></div>' +
        '<div class="st-rain-plot" id="stRainPlot"></div>' +
      '</div>' +
      '<div class="st-rain-legend">' +
        '<span class="st-lg-obs">Observado</span>' +
        '<span class="st-lg-fc">Previsión</span>' +
        '<span class="st-lg-nd" id="stRainNd" hidden>Sin dato</span>' +
        '<span class="st-lg-win">Ventana de 14 d del motor</span>' +
      '</div>' +
      '<div class="st-rain-window" id="stRainWindow"></div>' +
      '<p class="st-panel-note">Cada barra es la lluvia diaria ya registrada o prevista (tabla de Meteorología). El valor de la ventana es el que da el motor, no una suma propia.</p>';
    return p;
  }

  function resolveStatsRefs() {
    dom.spRows = byId("stSpRows");
    dom.spReparto = byId("stSpReparto");
    dom.rainPlot = byId("stRainPlot");
    dom.rainY = byId("stRainY");
    dom.rainWin = byId("stRainWindow");
    dom.rainNd = byId("stRainNd");
  }

  function refreshSpeciesStats() {
    var box = dom.spRows, rep = dom.spReparto;
    if (!box || !rep) return;
    var sp = readSpecies();
    if (!sp.length) {
      box.innerHTML = '<p class="st-vacio">Sin datos todavía. Pulsa el mapa para analizar un punto.</p>';
      rep.innerHTML = "";
      return;
    }
    var cuenta = { excelente: 0, bueno: 0, regular: 0, nulo: 0 }, html = "", i;
    for (i = 0; i < sp.length; i++) {
      var s = sp[i];
      cuenta[s.lvl]++;
      html += '<div class="st-sp-row" data-lvl="' + s.lvl + '">' +
          '<div class="st-sp-name"><b>' + esc(s.name) + '</b><i>' + esc(s.sci) + '</i></div>' +
          '<div class="st-sp-bar"><span style="width:' + Math.max(0, Math.min(100, s.v)).toFixed(1) + '%"></span></div>' +
          '<div class="st-sp-val">' + s.v.toFixed(1) + '</div>' +
          '<div class="st-sp-lvl">' + NIVELLBL[s.lvl] + '</div>' +
        '</div>';
    }
    box.innerHTML = html;

    var total = sp.length, seg = "", ley = "", orden = ["excelente", "bueno", "regular", "nulo"];
    for (i = 0; i < orden.length; i++) {
      var k = orden[i];
      if (!cuenta[k]) continue;
      seg += '<span class="st-sg-' + k + '" style="width:' + (cuenta[k] / total * 100).toFixed(1) + '%"></span>';
      ley += '<span class="st-lg-' + k + '"><b>' + cuenta[k] + '</b> ' + NIVELLBL[k].toLowerCase() + '</span>';
    }
    rep.innerHTML = '<div class="st-sp-seg">' + seg + '</div>' +
      '<div class="st-sp-leyenda">' + ley +
      '<span class="st-sp-total">' + total + (total === 1 ? " especie con dato" : " especies con dato") + '</span></div>';
  }

  function refreshRainStats() {
    var plot = dom.rainPlot;
    if (!plot) return;
    var r = readRain(), obs = r.obs.slice(-30), fc = r.fc.slice(0, 7);
    var cols = obs.concat(fc);
    if (!cols.length) {
      plot.innerHTML = '<p class="st-vacio">Sin datos de lluvia todavía. Pulsa el mapa para analizar un punto.</p>';
      if (dom.rainY) dom.rainY.innerHTML = "";
      if (dom.rainWin) dom.rainWin.innerHTML = "";
      if (dom.rainNd) dom.rainNd.hidden = true;
      return;
    }
    var max = 0, nd = 0, i, nObs = obs.length, total = cols.length;
    for (i = 0; i < total; i++) {
      if (cols[i].mm == null) { nd++; continue; }
      if (cols[i].mm > max) max = cols[i].mm;
    }
    var scale = Math.max(max, 1) * 1.12;
    if (dom.rainY) {
      dom.rainY.innerHTML =
        '<span style="top:0%">' + n1(scale) + '</span>' +
        '<span style="top:50%">' + n1(scale / 2) + '</span>' +
        '<span style="top:100%">0</span>';
    }
    var lab = {};
    for (i = 0; i < total; i += 5) lab[i] = true;
    if (!lab[total - 1] && (total - 1) % 5 >= 2) lab[total - 1] = true;
    var winFrom = Math.max(0, nObs - 14), colW = 100 / total, bars = "";
    for (i = 0; i < total; i++) {
      var c = cols[i], isFc = i >= nObs;
      var h = c.mm == null ? 0 : Math.max(0, Math.min(100, c.mm / scale * 100));
      var inWin = !isFc && i >= winFrom;
      var txt = c.d + " · " + (c.mm == null ? "sin dato" : c.mm.toFixed(1) + " mm") +
                (isFc ? " · previsión" : " · observado");
      bars += '<div class="st-rain-col' + (isFc ? " is-fc" : " is-obs") +
                (c.mm == null ? " is-nd" : "") + (inWin ? " in-win" : "") + '"' +
              ' title="' + esc(txt) + '" aria-label="' + esc(txt) + '">' +
                '<span class="st-rain-bar" style="height:' + h.toFixed(1) + '%"></span>' +
                (lab[i] ? '<i class="st-rain-xt">' + esc(c.d.replace(/^[^\d]*/, "")) + '</i>' : "") +
              '</div>';
    }
    plot.innerHTML =
      '<div class="st-rain-grid" aria-hidden="true"><i style="top:0"></i><i style="top:50%"></i><i style="top:100%"></i></div>' +
      (winFrom < nObs ? '<div class="st-rain-winband" style="left:' + (winFrom * colW).toFixed(2) +
                        '%;width:' + ((nObs - winFrom) * colW).toFixed(2) + '%"></div>' : "") +
      bars;
    plot.setAttribute("role", "img");
    plot.setAttribute("aria-label", "Lluvia diaria: " + nObs + " días observados y " + (total - nObs) +
      " de previsión. Los valores exactos están en la tabla de Meteorología.");
    if (dom.rainNd) dom.rainNd.hidden = nd === 0;
    if (!dom.rainWin) return;

    /* Ventana hídrica: valor y objetivo REALES de la propia fila de
       condiciones de la especie con mayor índice (si la tiene). */
    var sp = readSpecies(), rc = null, spName = "";
    for (i = 0; i < sp.length && !rc; i++) {
      var found = rainCondition(sp[i].card);
      if (found && found.val != null && found.obj) { rc = found; spName = sp[i].name; }
    }
    if (!rc) { dom.rainWin.innerHTML = ""; return; }
    var o1 = rc.obj[0], o2 = rc.obj[1];
    var top = Math.max(o2 * 1.25, rc.val * 1.08, o2 + 1);
    var bl = o1 / top * 100, bw = (o2 - o1) / top * 100;
    var vw = Math.max(0, Math.min(100, rc.val / top * 100));
    dom.rainWin.innerHTML =
      '<div class="st-rw-head"><b>Ventana hídrica · últimos 14 días</b>' +
        '<span>' + esc(spName) + ' · <b>' + rc.val.toFixed(0) + ' L/m²</b> · objetivo ' + o1 + '–' + o2 + ' L/m²</span></div>' +
      '<div class="st-rw-track">' +
        '<span class="st-rw-band" style="left:' + bl.toFixed(2) + '%;width:' + bw.toFixed(2) + '%"></span>' +
        '<span class="st-rw-fill ' + rc.est + '" style="width:' + vw.toFixed(2) + '%"></span>' +
      '</div>' +
      '<div class="st-rw-scale"><span>0</span><span>' + Math.round(top) + ' L/m²</span></div>';
  }

  function refreshStats() {
    refreshSpeciesStats();
    refreshRainStats();
  }

  function refreshDerived() {
    if (!built) return;
    refreshMirrors();
    refreshHero();
    refreshStats();
  }
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; refreshDerived(); });
  }

  function attach() {
    if (obs) return;
    obs = new MutationObserver(schedule);
    var targets = [
      document.querySelector("#dashboard .terrain-list"),
      byId("mushroomCards"),
      byId("lastUpdate"),
      byId("metObsBody"),
      byId("metFcBody")
    ];
    for (var i = 0; i < targets.length; i++) {
      if (targets[i]) obs.observe(targets[i], { subtree: true, childList: true, characterData: true });
    }
    if (dom.panel) {
      attrObs = new MutationObserver(syncDrawer);
      attrObs.observe(dom.panel, { attributes: true, attributeFilter: ["hidden"] });
    }
  }
  function detach() {
    if (obs) { obs.disconnect(); obs = null; }
    if (attrObs) { attrObs.disconnect(); attrObs = null; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  function syncDrawer() {
    if (!dom.aside || !dom.panel) return;
    dom.aside.classList.toggle("st-open", !dom.panel.hidden);
  }

  /* En móvil el selector «mis setales y cotos» vuelve a la tarjeta del mapa
     (su sitio original); en escritorio vive en la barra superior. */
  function placeFav() {
    if (!dom.fav || !dom.tools || !dom.mapCard) return;
    var mobile = window.innerWidth <= 1024;
    var inTools = dom.fav.parentNode === dom.tools;
    if (mobile && inTools) {
      var map = byId("dashboardMap");
      if (map && map.parentNode === dom.mapCard) dom.mapCard.insertBefore(dom.fav, map);
      else dom.mapCard.appendChild(dom.fav);
    } else if (!mobile && !inTools) {
      dom.tools.insertBefore(dom.fav, toggleBtn || null);
    }
  }

  function afterLayout() {
    requestAnimationFrame(function () {
      measureHeader();
      // Leaflet escucha 'resize' en window: así recalcula el mapa tras mover nodos
      window.dispatchEvent(new Event("resize"));
      requestAnimationFrame(function () { measureHeader(); window.dispatchEvent(new Event("resize")); });
    });
  }

  /* El alto real de la cabecera cambia entre escritorio y móvil: se mide y se
     publica en --st-headpx para que la barra lateral y el cajón se ajusten. */
  function measureHeader() {
    if (!on) return;
    var h = document.querySelector(".header");
    if (!h) return;
    var px = Math.round(h.getBoundingClientRect().height);
    if (px > 0) ROOT.style.setProperty("--st-headpx", px + "px");
  }

  /* ── Restauración del DOM ────────────────────────────────────────────── */
  function teardown() {
    if (!built) return;
    built = false;
    for (var i = moved.length - 1; i >= 0; i--) {
      var m = moved[i];
      try { m.p.insertBefore(m.n, m.s); }
      catch (e) { try { m.p.appendChild(m.n); } catch (e2) {} }
    }
    moved = [];
    for (var j = created.length - 1; j >= 0; j--) {
      var n = created[j];
      try { if (n.parentNode) n.parentNode.removeChild(n); } catch (e3) {}
    }
    created = [];
    onceDone = [];
    ROOT.style.removeProperty("--st-headpx");
    if (dom.panel) dom.panel.hidden = true;   // estado original del panel
    dom = {};
    /* La puerta de entrada nunca se va: si el botón quedó suelto, vuelve. */
    if (toggleBtn && toggleBtn.parentNode !== document.querySelector(".header-inner")) {
      mountToggle();
    }
    updateToggle();
  }

  /* ── API pública ─────────────────────────────────────────────────────── */
  function enable() {
    if (on) return;
    on = true;
    mountToggle();                              // por si aún no existía (p. ej. header tardío)
    ROOT.setAttribute("data-mhstudio", "on");
    applyTheme();
    build();
    attach();
    syncDrawer();
    updateToggle();
    refreshDerived();
    afterLayout();
    try { localStorage.setItem(KEY, "on"); } catch (e) {}
    document.dispatchEvent(new CustomEvent("mhstudiochange", { detail: { on: true } }));
  }

  function disable() {
    if (!on) return;
    on = false;
    ROOT.removeAttribute("data-mhstudio");
    detach();
    teardown();
    applyTheme();
    afterLayout();
    try { localStorage.setItem(KEY, "off"); } catch (e) {}
    document.dispatchEvent(new CustomEvent("mhstudiochange", { detail: { on: false } }));
  }

  function toggle() { if (on) disable(); else enable(); }

  window.MHStudio = {
    enable: enable,
    disable: disable,
    toggle: toggle,
    refresh: refreshDerived,
    isOn: function () { return on; }
  };

  /* El selector de temas sigue funcionando: si se cambia de tema con el
     observatorio activo, se vuelven a silenciar las hojas de tema. */
  function hookThemeSelect() {
    var sel = byId("themeSelect");
    if (!sel || sel.dataset.stHook) return;
    sel.dataset.stHook = "1";
    sel.addEventListener("change", function () { if (on) applyTheme(); });
  }

  window.addEventListener("resize", function () {
    if (!on) return;
    placeFav();
    measureHeader();
    if (dom.panel && window.innerWidth > 1024 && dom.panel.hidden) dom.panel.hidden = false;
  });

  hookThemeSelect();
  function boot() {
    hookThemeSelect();
    mountToggle();                              // la entrada está siempre disponible
    var want = false;
    try { want = localStorage.getItem(KEY) === "on"; } catch (e) {}
    if (want) enable();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
