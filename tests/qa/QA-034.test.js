// QA-034 — Estado "ativo" de chips/tabs não atinge contraste mínimo AA.
// O padrão `color: var(--accent)` (ou var(--accent-hv), em dev.css) sobre
// `background: var(--accent-dim)` falha o contraste mínimo AA (4.5:1) —
// confirmado via axe-core (impacto "serious") em várias páginas. Corrigido
// introduzindo `--accent-text` (uma variante mais clara de --accent,
// pensada especificamente para texto sobre --accent-dim) em
// design-system.css, usada nos 7 arquivos que de fato tinham esse padrão.
//
// Nota: `empresa-desenvolvedores.css` estava listado no achado original,
// mas seu único `.filter-chip.active` usa `--teal`/`--teal-dim`, não
// `--accent`/`--accent-dim` — não tem o bug descrito. Não foi tocado (ver
// nota de status em CLAUDE.md).
const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '..', '..', 'public', 'css');
const readCss = name => fs.readFileSync(path.join(CSS_DIR, name), 'utf8');

// ── Resolução mínima de var() a partir de design-system.css ──────────────
const designSystem = readCss('design-system.css');
function readVar(name) {
  const m = designSystem.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`Variável --${name} não encontrada em design-system.css`);
  return m[1].trim();
}

function parseColor(value) {
  value = value.trim();
  const hexMatch = value.match(/^#([0-9a-fA-F]{6})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgbaMatch = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (rgbaMatch) {
    return {
      r: parseFloat(rgbaMatch[1]),
      g: parseFloat(rgbaMatch[2]),
      b: parseFloat(rgbaMatch[3]),
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    };
  }
  throw new Error(`Não consegui parsear a cor: "${value}"`);
}

// Composita uma cor com alpha sobre um fundo opaco
function compositeOver(fg, bg) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

// Luminância relativa (WCAG 2.x)
function relativeLuminance({ r, g, b }) {
  const chan = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastRatio(colorA, colorB) {
  const l1 = relativeLuminance(colorA);
  const l2 = relativeLuminance(colorB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Fundo representativo onde os chips/tabs aparecem (cards/superfícies escuras do app)
const SURFACE_BG = parseColor(readVar('bg-3'));
const ACCENT_DIM_BG = compositeOver(parseColor(readVar('accent-dim')), SURFACE_BG);

function resolveTextColorVar(cssFile, selectorRegex) {
  const content = readCss(cssFile);
  const ruleMatch = content.match(selectorRegex);
  if (!ruleMatch) throw new Error(`Regra não encontrada em ${cssFile}: ${selectorRegex}`);
  const colorMatch = ruleMatch[0].match(/(?<![\w-])color:\s*var\(--([a-z0-9-]+)\)/);
  if (!colorMatch) throw new Error(`Nenhum "color: var(--...)" na regra encontrada em ${cssFile}`);
  return parseColor(readVar(colorMatch[1]));
}

const CASES = [
  ['dashboard.css',               /\.filter-chip\.active\s*\{[^}]*\}/],
  ['empresa-dashboard.css',       /\.filter-chip\.active\s*\{[^}]*\}/],
  ['progresso.css',               /\.status-tab\.active\s*\{[^}]*\}/],
  ['mensagens.css',               /\.msg-filter-tab\.active\s*\{[^}]*\}/],
  ['empresa-matchs.css',          /\.filter-chip\.active\s*\{[^}]*\}/],
  ['vagas.css',                   /\.filter-chip\.active\s*\{[^}]*\}/],
  ['dev.css',                     /\.filter-chip\.active,\s*\.filter-chip\[aria-pressed="true"\]\s*\{[^}]*\}/],
];

describe('QA-034 — chips/tabs "ativos" atingem contraste mínimo AA (4.5:1)', () => {
  test.each(CASES)('%s: cor do texto sobre --accent-dim tem contraste >= 4.5:1', (file, selectorRegex) => {
    const textColor = resolveTextColorVar(file, selectorRegex);
    const ratio = contrastRatio(textColor, ACCENT_DIM_BG);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
