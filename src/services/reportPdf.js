'use strict';

/**
 * Render del informe diario en PDF (pdfkit, sin Chrome). Recibe el DTO de reportData.buildReport.
 * Página 390 pt de ancho, alto automático, ~3 rutas por página. Tema claro, contraste AA.
 */

const path = require('path');
const PDFDocument = require('pdfkit');

const FONTS = path.join(__dirname, '..', '..', 'assets', 'fonts');
const C = {
  navy: '#0a192f', mint: '#64ffda', bg: '#ffffff', card: '#f5f7fa', border: '#e3e8ef',
  text: '#0a192f', muted: '#545e6b', accent: '#0f8a6f', warn: '#e0a84f', warnText: '#8a5a00', emptyBg: '#eef1f5',
};
const W = 390;
const M = 16;
const CW = W - 2 * M;
const PAD = 16;
const PER_PAGE = 3;
const ROWS_PER_PAGE = 20;

function fonts(doc) {
  doc.registerFont('R', path.join(FONTS, 'Inter-Regular.ttf'));
  doc.registerFont('S', path.join(FONTS, 'Inter-SemiBold.ttf'));
  doc.registerFont('B', path.join(FONTS, 'Inter-Bold.ttf'));
}

/** Logo: avión de papel menta sobre navy. */
function logo(doc, x, y) {
  doc.save();
  doc.roundedRect(x, y, 32, 32, 8).fill('#112240');
  doc.polygon([x + 7, y + 16], [x + 26, y + 7], [x + 20, y + 26], [x + 16, y + 19]).fill(C.mint);
  doc.polygon([x + 16, y + 19], [x + 26, y + 7], [x + 14, y + 24]).fill('#3fcfae');
  doc.restore();
}

function text(doc, draw, s, x, y, opts) {
  const o = { lineGap: 2, ...opts };
  const font = o.font || 'R';
  const size = o.size || 12;
  doc.font(font).fontSize(size);
  const h = doc.heightOfString(s, { width: o.width, lineGap: o.lineGap });
  if (draw) {
    doc.fillColor(o.color || C.text).text(s, x, y, { width: o.width, align: o.align || 'left', lineGap: o.lineGap, features: o.tnum ? ['tnum'] : undefined, lineBreak: true });
  }
  return h;
}

function header(doc, r) {
  doc.rect(0, 0, W, 72).fill(C.navy);
  logo(doc, M, 20);
  text(doc, true, r.brand, 56, 12, { font: 'B', size: 16, color: C.mint, width: 180 });
  text(doc, true, r.date, 56, 33, { size: 12, color: '#ffffff', width: 190 });
  text(doc, true, r.hello, 56, 50, { size: 12, color: '#ccd6f6', width: 190 });
  text(doc, true, r.generated, W - M - 120, 14, { size: 12, color: '#ccd6f6', width: 120, align: 'right' });
  return 72;
}

function kpis(doc, r, y, draw) {
  if (r.allEmpty || !r.kpis.best) {
    const h = text(doc, false, r.allEmptyText, M + PAD, 0, { size: 14, width: CW - 2 * PAD }) + 2 * PAD;
    if (draw) {
      doc.roundedRect(M, y, CW, h, 12).fillAndStroke(C.card, C.border);
      text(doc, true, r.allEmptyText, M + PAD, y + PAD, { size: 14, width: CW - 2 * PAD });
    }
    return h + 16;
  }
  const items = [r.kpis.active, { ...r.kpis.under, sub: r.kpis.dropped ? `${r.kpis.dropped.label}: ${r.kpis.dropped.value}` : null }, r.kpis.best];
  const gap = 8;
  const w = (CW - gap * 2) / 3;
  const h = 80;
  if (draw) {
    items.forEach((k, i) => {
      const x = M + i * (w + gap);
      doc.roundedRect(x, y, w, h, 12).fillAndStroke(C.card, C.border);
      text(doc, true, k.label, x + 10, y + 10, { size: 12, color: C.muted, width: w - 20 });
      text(doc, true, k.value, x + 10, y + 30, { font: 'B', size: k.value.length > 7 ? 16 : 20, width: w - 20, tnum: true });
      if (k.sub) text(doc, true, k.sub, x + 10, y + 56, { size: 12, color: C.muted, width: w - 20 });
    });
  }
  return h + 16;
}

function chip(doc, draw, d, label, x, y) {
  const arrow = d.dir === 'down' ? '\u2193' : d.dir === 'up' ? '\u2191' : '\u2192';
  const s = `${arrow} ${d.label} ${label}`;
  doc.font('S').fontSize(12);
  const w = doc.widthOfString(s) + 16;
  if (draw) {
    const fill = d.dir === 'down' ? '#e3f4ef' : d.dir === 'up' ? '#fbf0de' : C.card;
    const color = d.dir === 'down' ? C.accent : d.dir === 'up' ? C.warnText : C.muted;
    doc.roundedRect(x, y, w, 24, 12).fillAndStroke(fill, C.border);
    doc.fillColor(color).text(s, x + 8, y + 5, { lineBreak: false, features: ['tnum'] });
  }
  return w;
}

function sparkline(doc, pts, x, y, w, h, today) {
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const px = (i) => x + (i / (pts.length - 1)) * w;
  const py = (v) => y + h - ((v - min) / span) * h;
  doc.save();
  doc.lineWidth(1.5).strokeColor(C.accent);
  pts.forEach((v, i) => (i === 0 ? doc.moveTo(px(i), py(v)) : doc.lineTo(px(i), py(v))));
  doc.stroke();
  const mi = pts.indexOf(min);
  doc.circle(px(mi), py(min), 2.5).lineWidth(1).fillAndStroke('#ffffff', C.accent);
  if (today) doc.circle(px(pts.length - 1), py(pts[pts.length - 1]), 3).fill(C.accent);
  doc.restore();
}

function button(doc, draw, label, url, x, y, w, outline) {
  if (draw) {
    if (outline) doc.roundedRect(x, y, w, 44, 12).lineWidth(1.5).fillAndStroke('#ffffff', C.navy);
    else doc.roundedRect(x, y, w, 44, 12).fill(C.navy);
    doc.font('B').fontSize(14).fillColor(outline ? C.navy : '#ffffff').text(label, x, y + 14, { width: w, align: 'center', lineBreak: false });
    if (url) doc.link(x, y, w, 44, url);
  }
  return 44;
}

function pricedCard(doc, c, y, draw) {
  const x = M + PAD;
  const w = CW - 2 * PAD;
  let cy = y + PAD;
  if (draw) {
    doc.font('S').fontSize(12);
    const pill = `${c.state === 'deal' ? '\u2713' : '\u2191'} ${c.stateLabel}`;
    const pw = doc.widthOfString(pill) + 16;
    doc.roundedRect(M + CW - PAD - pw, cy - 2, pw, 22, 11).fill(c.state === 'deal' ? '#e3f4ef' : '#fbf0de');
    doc.fillColor(c.state === 'deal' ? C.accent : C.warnText).text(pill, M + CW - PAD - pw + 8, cy + 2, { lineBreak: false });
  }
  cy += text(doc, draw, c.title, x, cy, { font: 'B', size: 16, width: w - 140 });
  cy += text(doc, draw, c.trip, x, cy, { size: 12, color: C.muted, width: w - 140 }) + 6;
  const priceH = 34;
  if (draw) {
    text(doc, true, c.priceLabel, x, cy, { font: 'B', size: 28, width: w - 130, tnum: true, lineGap: 0 });
    if (c.spark) sparkline(doc, c.spark, M + CW - PAD - 120, cy + 1, 120, 32, c.sparkToday);
  }
  cy += priceH + 8;
  if (c.ceiling) {
    if (draw) {
      const scale = Math.max(c.price, c.ceiling) * 1.15;
      doc.roundedRect(x, cy, w, 8, 4).fill(C.border);
      doc.roundedRect(x, cy, Math.max(8, (c.price / scale) * w), 8, 4).fill(c.state === 'deal' ? C.accent : C.warn);
      const cx = x + (c.ceiling / scale) * w;
      doc.rect(cx - 1, cy - 4, 2, 16).fill(C.navy);
    }
    cy += 16;
  }
  cy += text(doc, draw, [c.ceilingLabel, c.vsCeiling].filter(Boolean).join(' \u00B7 '), x, cy, { size: 12, color: C.muted, width: w, tnum: true }) + 8;
  const chips = [[c.deltaDay, c.deltaDayLabel], [c.delta7, c.delta7Label]].filter(([d]) => d);
  if (chips.length) {
    let chx = x;
    for (const [d, label] of chips) chx += chip(doc, draw, d, label, chx, cy) + 8;
    cy += 32;
  }
  const det = [c.dates, c.airline, c.stops].filter(Boolean).join(' \u00B7 ');
  if (det) cy += text(doc, draw, det, x, cy, { size: 12, width: w, tnum: true });
  cy += text(doc, draw, c.sourceLine, x, cy, { size: 12, color: C.muted, width: w });
  if (c.confirmed) cy += text(doc, draw, c.confirmed, x, cy, { size: 12, color: C.accent, width: w });
  if (c.advice) cy += text(doc, draw, c.advice, x, cy, { font: 'S', size: 12, width: w });
  cy += text(doc, draw, c.disclaimer, x, cy, { size: 12, color: C.muted, width: w }) + 8;
  cy += button(doc, draw, c.cta, c.url, x, cy, w, false);
  const h = cy + PAD - y;
  return h;
}

function emptyCard(doc, c, y, draw) {
  const x = M + PAD;
  const w = CW - 2 * PAD;
  let cy = y + PAD;
  cy += text(doc, draw, c.title, x, cy, { font: 'B', size: 16, width: w });
  cy += text(doc, draw, `${c.trip} \u00B7 ${c.ceilingLabel}`, x, cy, { size: 12, color: C.muted, width: w }) + 8;
  cy += text(doc, draw, `\u2014 ${c.emptyTitle}`, x, cy, { font: 'S', size: 14, color: C.muted, width: w });
  cy += text(doc, draw, c.lastSeen, x, cy, { size: 12, width: w, tnum: true });
  if (c.trend) cy += text(doc, draw, c.trend, x, cy, { size: 12, width: w });
  cy += text(doc, draw, c.tip, x, cy + 4, { size: 12, color: C.muted, width: w }) + 12;
  cy += button(doc, draw, c.cta, c.ctaUrl, x, cy, w, true);
  return cy + PAD - y;
}

function card(doc, c, y, draw) {
  const fn = c.state === 'empty' ? emptyCard : pricedCard;
  const h = fn(doc, c, y, false);
  if (draw) {
    doc.roundedRect(M, y, CW, h, 12).lineWidth(1).fillAndStroke(c.state === 'empty' ? C.emptyBg : C.card, C.border);
    fn(doc, c, y, true);
  }
  return h;
}

/** Tabla compacta para las rutas que no entran como tarjeta: ruta · precio · estado. */
function table(doc, r, rows, y, draw, withTitle, withMore) {
  let cy = y;
  if (withTitle) cy += text(doc, draw, r.compactTitle, M, cy, { font: 'S', size: 14, width: CW }) + 8;
  const rowH = 28;
  const h = rows.length * rowH;
  if (draw && rows.length) doc.roundedRect(M, cy, CW, h, 12).lineWidth(1).fillAndStroke(C.card, C.border);
  rows.forEach((row, i) => {
    const ry = cy + i * rowH;
    if (draw) {
      if (i > 0) doc.moveTo(M + 8, ry).lineTo(M + CW - 8, ry).lineWidth(0.5).stroke(C.border);
      const color = row.state === 'deal' ? C.accent : row.state === 'above' ? C.warnText : C.muted;
      doc.font('S').fontSize(12).fillColor(C.text).text(row.title, M + 12, ry + 8, { width: 150, lineBreak: false, ellipsis: true });
      doc.font('B').fontSize(12).fillColor(C.text).text(row.price, M + 160, ry + 8, { width: 70, align: 'right', lineBreak: false, features: ['tnum'] });
      doc.font('R').fontSize(12).fillColor(color).text(row.status, M + 240, ry + 8, { width: CW - 252, align: 'right', lineBreak: false, ellipsis: true });
      if (row.url) doc.link(M, ry, CW, rowH, row.url);
    }
  });
  cy += h + 8;
  if (withMore && r.moreText) cy += text(doc, draw, r.moreText, M, cy, { size: 12, color: C.muted, width: CW }) + 4;
  return cy - y + 8;
}

function footer(doc, r, y, draw) {
  const x = M;
  let cy = y + 8;
  if (r.note) cy += text(doc, draw, r.note, x, cy, { font: 'B', size: 12, color: C.warnText, width: CW }) + 6;
  cy += text(doc, draw, r.footer.watch, x, cy, { font: 'S', size: 14, width: CW }) + 4;
  if (r.footer.upsell) cy += text(doc, draw, r.footer.upsell, x, cy, { size: 12, color: C.accent, width: CW }) + 4;
  if (r.footer.manageUrl) {
    const h = text(doc, draw, `${r.footer.manage} \u2192`, x, cy, { font: 'S', size: 12, color: C.accent, width: CW });
    if (draw) doc.link(x, cy, CW, h, r.footer.manageUrl);
    cy += h + 4;
  }
  cy += text(doc, draw, r.footer.affiliate, x, cy, { size: 12, color: C.muted, width: CW }) + 4;
  cy += text(doc, draw, r.footer.unsub, x, cy, { size: 12, color: C.muted, width: CW });
  return cy - y + 8;
}

/** Páginas: tarjetas completas (3 por página) y después la tabla compacta (20 filas por página). */
function pagesOf(report) {
  const cards = report.full || report.cards;
  const rows = report.compact || [];
  const pages = [];
  for (let i = 0; i < cards.length; i += PER_PAGE) pages.push({ cards: cards.slice(i, i + PER_PAGE), rows: [] });
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) pages.push({ cards: [], rows: rows.slice(i, i + ROWS_PER_PAGE), firstRows: i === 0 });
  if (!pages.length) pages.push({ cards: [], rows: [] });
  if (!rows.length && report.moreText) pages[pages.length - 1].firstRows = true;
  return pages;
}

let scratchDoc = null;
/** Documento auxiliar único (nunca se cierra) para medir alturas; evita re-parsear fuentes en cada render. */
function measurer() {
  if (!scratchDoc) {
    scratchDoc = new PDFDocument({ autoFirstPage: false, margin: 0, compress: false });
    fonts(scratchDoc);
    scratchDoc.addPage({ size: [W, 2000], margin: 0 });
    scratchDoc.on('data', () => {});
  }
  return scratchDoc;
}

/** Devuelve un Buffer con el PDF. */
function renderReport(report) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ autoFirstPage: false, margin: 0, compress: true, info: { Title: `FlightAlert ${report.dayIso}`, Author: 'FlightAlert' } });
      fonts(doc);
      const chunks = [];
      doc.on('data', (b) => chunks.push(b));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const pages = pagesOf(report);
      // Medición en un documento auxiliar (pdfkit fija el alto al crear la página).
      const scratch = measurer();
      pages.forEach((pg, pi) => {
        const first = pi === 0;
        const last = pi === pages.length - 1;
        const plan = (d, draw) => {
          let y = first ? (draw ? header(d, report) : 72) + 16 : 16;
          if (first) y += kpis(d, report, y, draw);
          if (first && report.note) y += text(d, draw, report.note, M, y, { font: 'B', size: 12, color: C.warnText, width: CW }) + 8;
          for (const c of pg.cards) y += card(d, c, y, draw) + 12;
          if (pg.rows.length) y += table(d, report, pg.rows, y, draw, pg.firstRows, last);
          if (last) y += footer(d, report, y, draw);
          if (pages.length > 1) y += text(d, draw, report.pageLabel(pi + 1, pages.length), M, y, { size: 12, color: C.muted, width: CW, align: 'center' });
          return y + 16;
        };
        const h = Math.ceil(plan(scratch, false));
        doc.addPage({ size: [W, h], margin: 0 });
        doc.rect(0, 0, W, h).fill(C.bg);
        plan(doc, true);
      });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { renderReport, pagesOf, COLORS: C, PER_PAGE, ROWS_PER_PAGE };
