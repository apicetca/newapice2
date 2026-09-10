// QA-039 — Componente de "estado vazio" usa <h3> fixo, pulando nível de
// heading. Em insights-mercado.ejs e repositorios.ejs, o heading do estado
// vazio aparece logo depois do <h1> da página como <h3>, pulando o <h2> —
// mesma categoria de bug do QA-018, mas em arquivos fora do escopo dele.
// Corrigido trocando esses dois <h3> para <h2>.
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

describe('QA-039 — heading do estado vazio não pula nível', () => {
  test('insights-mercado.ejs: "Ainda não há dados suficientes" é <h2>, não <h3>', () => {
    const content = readView('insights-mercado.ejs');
    expect(content).toMatch(/<h2>Ainda não há dados suficientes<\/h2>/);
    expect(content).not.toMatch(/<h3>Ainda não há dados suficientes<\/h3>/);
  });

  test('repositorios.ejs: "Nenhum repositório no perfil" é <h2>, não <h3>', () => {
    const content = readView('repositorios.ejs');
    expect(content).toMatch(/<h2>Nenhum repositório no perfil<\/h2>/);
    expect(content).not.toMatch(/<h3>Nenhum repositório no perfil<\/h3>/);
  });
});
