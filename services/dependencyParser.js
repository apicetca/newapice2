// ============================================
// services/dependencyParser.js
// Extrai os nomes dos pacotes declarados nos arquivos de dependências da raiz
// de um repositório (package.json, requirements.txt…). É a evidência mais
// segura de que o projeto usa um framework, já que o endpoint de linguagens do
// GitHub só devolve linguagens (docs/analise-perfil.md, limitação 2).
//
// Tudo aqui é puro (texto → lista de nomes em minúsculas). Arquivo mal
// formado devolve lista vazia — nunca lança erro.
// ============================================

// Arquivos procurados na raiz do repositório.
const ARQUIVOS_DEPENDENCIAS = [
  "package.json", "requirements.txt", "pyproject.toml", "pom.xml",
  "build.gradle", "composer.json", "Gemfile", "go.mod",
];

const unicos = (lista) => [...new Set(lista.map(n => String(n).trim().toLowerCase()).filter(Boolean))];

// npm: dependencies, devDependencies, peerDependencies, optionalDependencies.
// Pacote com escopo (@nestjs/core) também conta pelo escopo (nestjs),
// exceto @types/*.
function parsePackageJson(texto) {
  let json;
  try { json = JSON.parse(texto); } catch { return []; }
  if (!json || typeof json !== "object") return [];
  const nomes = [];
  for (const campo of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = json[campo];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    for (const nome of Object.keys(deps)) {
      nomes.push(nome);
      // @types/* são só definições de tipo: o escopo "types" não diz nada.
      const escopo = nome.match(/^@([^/]+)\//);
      if (escopo && escopo[1] !== "types") nomes.push(escopo[1]);
    }
  }
  return unicos(nomes);
}

// Nome de pacote Python: tudo antes de versão, extras, marcadores ou espaço.
function nomePacotePython(especificacao) {
  const m = String(especificacao).trim().match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
  return m ? m[1] : null;
}

function parseRequirementsTxt(texto) {
  return unicos(
    String(texto).split(/\r?\n/)
      .map(l => l.replace(/#.*/, "").trim())
      .filter(l => l && !l.startsWith("-"))   // -r outro.txt, -e ., --index-url
      .map(nomePacotePython)
      .filter(Boolean)
  );
}

// pyproject.toml: lista `dependencies = [...]` (PEP 621, inclusive optional)
// e as chaves de [tool.poetry.*dependencies]. Leitura simples, sem parser TOML.
function parsePyprojectToml(texto) {
  const nomes = [];
  const s = String(texto);

  // Lê cada lista `dependencies = [...]` respeitando as aspas: o "]" de um
  // extra ("sqlalchemy[asyncio]") não pode encerrar a lista.
  for (const inicio of s.matchAll(/dependencies\s*=\s*\[/g)) {
    let i = inicio.index + inicio[0].length;
    let aspa = null;
    let atual = "";
    for (; i < s.length; i++) {
      const c = s[i];
      if (aspa) {
        if (c === aspa) { nomes.push(nomePacotePython(atual)); atual = ""; aspa = null; }
        else atual += c;
      } else if (c === '"' || c === "'") {
        aspa = c;
      } else if (c === "]") {
        break;
      }
    }
  }

  let naSecaoPoetry = false;
  for (const linha of s.split(/\r?\n/)) {
    const secao = linha.match(/^\s*\[([^\]]+)\]/);
    if (secao) { naSecaoPoetry = /^tool\.poetry\.(.*\.)?(dev-)?dependencies$/.test(secao[1].trim()); continue; }
    if (!naSecaoPoetry) continue;
    const chave = linha.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/);
    if (chave && chave[1].toLowerCase() !== "python") nomes.push(chave[1]);
  }
  return unicos(nomes.filter(Boolean));
}

// Maven: artifactId de cada <dependency> (o do próprio projeto fica de fora).
function parsePomXml(texto) {
  const nomes = [];
  for (const dep of String(texto).matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const art = dep[1].match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/);
    if (art) nomes.push(art[1]);
  }
  return unicos(nomes);
}

// Gradle: "grupo:artefato:versão" em implementation/api/testImplementation…
function parseBuildGradle(texto) {
  const nomes = [];
  for (const m of String(texto).matchAll(/["']([\w.-]+):([\w.-]+)(?::[^"']*)?["']/g)) nomes.push(m[2]);
  return unicos(nomes);
}

// Composer: require e require-dev; "laravel/framework" também conta pelo vendor.
function parseComposerJson(texto) {
  let json;
  try { json = JSON.parse(texto); } catch { return []; }
  if (!json || typeof json !== "object") return [];
  const nomes = [];
  for (const campo of ["require", "require-dev"]) {
    const deps = json[campo];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    for (const nome of Object.keys(deps)) {
      if (nome === "php" || nome.startsWith("ext-")) continue;
      nomes.push(nome);
      if (nome.includes("/")) nomes.push(nome.split("/")[0]);
    }
  }
  return unicos(nomes);
}

function parseGemfile(texto) {
  const nomes = [];
  for (const m of String(texto).matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) nomes.push(m[1]);
  return unicos(nomes);
}

// go.mod: caminho do módulo (github.com/gin-gonic/gin) e o último segmento (gin).
function parseGoMod(texto) {
  const nomes = [];
  const s = String(texto);
  const adicionar = (caminho) => {
    nomes.push(caminho);
    const ultimo = caminho.split("/").filter(p => !/^v\d+$/.test(p)).pop();
    if (ultimo) nomes.push(ultimo);
  };
  for (const bloco of s.matchAll(/require\s*\(([\s\S]*?)\)/g)) {
    for (const linha of bloco[1].split(/\r?\n/)) {
      const m = linha.trim().match(/^([^\s/]+\/[^\s]+)\s+v/);
      if (m) adicionar(m[1]);
    }
  }
  for (const m of s.matchAll(/^\s*require\s+([^\s(]+)\s+v/gm)) adicionar(m[1]);
  return unicos(nomes);
}

const PARSERS = {
  "package.json":     parsePackageJson,
  "requirements.txt": parseRequirementsTxt,
  "pyproject.toml":   parsePyprojectToml,
  "pom.xml":          parsePomXml,
  "build.gradle":     parseBuildGradle,
  "composer.json":    parseComposerJson,
  "gemfile":          parseGemfile,
  "go.mod":           parseGoMod,
};

/** Extrai os pacotes de um arquivo de dependências pelo nome do arquivo. */
function extrairPacotes(nomeArquivo, texto) {
  const parser = PARSERS[String(nomeArquivo).toLowerCase()];
  if (!parser || typeof texto !== "string") return [];
  try { return parser(texto); } catch { return []; }
}

module.exports = {
  ARQUIVOS_DEPENDENCIAS, extrairPacotes,
  parsePackageJson, parseRequirementsTxt, parsePyprojectToml, parsePomXml,
  parseBuildGradle, parseComposerJson, parseGemfile, parseGoMod,
};
