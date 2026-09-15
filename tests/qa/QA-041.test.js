// QA-041 — Número decorativo dos passos ("01"-"04") na landing page não
// atinge contraste mínimo AA. `.step-card__num` usava `color: var(--border-lite)`
// (#2a2a2a) sobre `background: var(--bg-2)` (#101010) — contraste ~1.33:1,
// bem abaixo do mínimo AA de 4.5:1 (axe-core, impacto "serious"). Corrigido
// clareando a cor o suficiente para atingir 4.5:1 mantendo o efeito sutil de
// "marca d'água".
const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '..', '..', 'public', 'css');
const readCss = name => fs.readFileSync(path.join(CSS_DIR, name), 'utf8');

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
    };
  }
  throw new Error(`Não consegui parsear a cor: "${value}"`);
}

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

const landingCss = readCss('landing.css');

function resolveStepNumColor() {
  const ruleMatch = landingCss.match(/\.step-card__num\s*\{[^}]*\}/);
  if (!ruleMatch) throw new Error('Regra .step-card__num não encontrada em landing.css');
  const varMatch = ruleMatch[0].match(/(?<![\w-])color:\s*var\(--([a-z0-9-]+)\)/);
  if (varMatch) return parseColor(readVar(varMatch[1]));
  const hexMatch = ruleMatch[0].match(/(?<![\w-])color:\s*(#[0-9a-fA-F]{6})/);
  if (hexMatch) return parseColor(hexMatch[1]);
  throw new Error('Nenhuma declaração "color:" reconhecível na regra .step-card__num');
}

describe('QA-041 — .step-card__num atinge contraste mínimo AA (4.5:1)', () => {
  test('cor do número decorativo sobre --bg-2 tem contraste >= 4.5:1', () => {
    const textColor = resolveStepNumColor();
    const bg = parseColor(readVar('bg-2'));
    const ratio = contrastRatio(textColor, bg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
