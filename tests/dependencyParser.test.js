// tests/dependencyParser.test.js
// Etapa 5 — extração dos nomes de pacotes dos arquivos de dependências.
const {
  ARQUIVOS_DEPENDENCIAS, extrairPacotes,
} = require("../services/dependencyParser");

describe("extrairPacotes", () => {
  test("lista de arquivos procurados", () => {
    expect(ARQUIVOS_DEPENDENCIAS).toEqual([
      "package.json", "requirements.txt", "pyproject.toml", "pom.xml",
      "build.gradle", "composer.json", "Gemfile", "go.mod",
    ]);
  });

  test("package.json: dependencies, devDependencies, peer e optional; escopo também conta", () => {
    const pkg = JSON.stringify({
      name: "minha-loja",
      dependencies: { React: "^18", "@nestjs/core": "^10" },
      devDependencies: { jest: "^29", "@types/node": "^20" },
      peerDependencies: { "react-dom": "^18" },
      optionalDependencies: { fsevents: "*" },
      scripts: { start: "node index.js" },
    });
    // @types/node entra pelo nome completo, mas o escopo "types" não
    expect(extrairPacotes("package.json", pkg).sort()).toEqual(
      ["@nestjs/core", "@types/node", "fsevents", "jest", "nestjs", "react", "react-dom"].sort()
    );
  });

  test.each([
    ["{ quebrado"],
    ["null"],
    ["[1,2]"],
    [JSON.stringify({ dependencies: ["react"] })],
  ])("package.json inválido (%s) → lista vazia, sem lançar", (texto) => {
    expect(extrairPacotes("package.json", texto)).toEqual([]);
  });

  test("requirements.txt: versões, extras, comentários e opções", () => {
    const txt = [
      "# app", "Django>=4.2", "fastapi[all]==0.110", "uvicorn ; python_version>'3.8'",
      "-r dev.txt", "--index-url https://x", "", "numpy  # cálculo", "scikit-learn~=1.4",
    ].join("\n");
    expect(extrairPacotes("requirements.txt", txt)).toEqual(["django", "fastapi", "uvicorn", "numpy", "scikit-learn"]);
  });

  test("pyproject.toml: PEP 621 e Poetry (sem python)", () => {
    const toml = [
      "[project]", "name = 'api'", "dependencies = [", '  "fastapi>=0.110",', '  "sqlalchemy[asyncio]",', "]",
      "", "[tool.poetry.dependencies]", 'python = "^3.11"', 'django = "^5"',
      "", "[tool.poetry.group.dev.dependencies]", 'pytest = "^8"', "", "[tool.black]", "line-length = 100",
    ].join("\n");
    expect(extrairPacotes("pyproject.toml", toml).sort()).toEqual(["django", "fastapi", "pytest", "sqlalchemy"]);
  });

  test("pom.xml: artifactId de cada dependência (não o do projeto)", () => {
    const pom = `<project><artifactId>minha-api</artifactId>
      <dependencies>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
        <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId></dependency>
      </dependencies></project>`;
    expect(extrairPacotes("pom.xml", pom)).toEqual(["spring-boot-starter-web", "postgresql"]);
  });

  test("build.gradle: artefato de grupo:artefato:versão", () => {
    const gradle = "dependencies {\n  implementation 'org.springframework.boot:spring-boot-starter-web:3.2.0'\n  testImplementation \"junit:junit:4.13\"\n}";
    expect(extrairPacotes("build.gradle", gradle)).toEqual(["spring-boot-starter-web", "junit"]);
  });

  test("composer.json: require e require-dev, sem php/ext-*, com o vendor", () => {
    const composer = JSON.stringify({ require: { php: "^8.2", "ext-json": "*", "laravel/framework": "^11" }, "require-dev": { "phpunit/phpunit": "^10" } });
    expect(extrairPacotes("composer.json", composer).sort()).toEqual(["laravel", "laravel/framework", "phpunit", "phpunit/phpunit"]);
  });

  test("Gemfile (nome do arquivo sem diferenciar maiúsculas)", () => {
    expect(extrairPacotes("gemfile", "source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\n  gem \"pg\"")).toEqual(["rails", "pg"]);
  });

  test("go.mod: caminho do módulo e último segmento (sem /vN)", () => {
    const gomod = "module x\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgithub.com/jackc/pgx/v5 v5.5.0\n)\nrequire github.com/joho/godotenv v1.5.1\n";
    expect(extrairPacotes("go.mod", gomod).sort()).toEqual([
      "gin", "github.com/gin-gonic/gin", "github.com/jackc/pgx/v5", "github.com/joho/godotenv", "godotenv", "pgx",
    ].sort());
  });

  test("arquivo desconhecido ou conteúdo que não é texto → vazio", () => {
    expect(extrairPacotes("setup.py", "install_requires=['x']")).toEqual([]);
    expect(extrairPacotes("package.json", undefined)).toEqual([]);
  });
});
