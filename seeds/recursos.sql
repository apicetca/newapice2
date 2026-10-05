-- Seed da tabela `recursos` (docs/roadmap-spec.md, seção "Recursos de estudo").
-- ~3 recursos para cada uma das ~20 habilidades mais comuns entre as 4 áreas
-- de data/habilidades-referencia.json. Prioridade: português e gratuito.
-- Fontes usadas apenas entre as permitidas: MDN, documentação oficial,
-- freeCodeCamp, Curso em Vídeo, Rocketseat, W3Schools, Alura gratuito.
--
-- INSERT IGNORE: seguro de rodar mais de uma vez — a UNIQUE KEY
-- uq_recursos_habilidade_url (migrations/20261001_roadmap_up.sql) garante
-- que rodar este seed de novo não duplica as linhas, só ignora as que já
-- existem (mesma combinação habilidade + url).

-- ── HTML ──────────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('HTML', 'HTML na MDN', 'https://developer.mozilla.org/pt-BR/docs/Web/HTML', 'doc', 'pt', 1, 'iniciante', 1),
('HTML', 'Curso de HTML5 e CSS3 — Curso em Vídeo', 'https://www.cursoemvideo.com/curso/html5-css3/', 'curso', 'pt', 1, 'iniciante', 1),
('HTML', 'HTML Tutorial — W3Schools', 'https://www.w3schools.com/html/', 'doc', 'en', 1, 'iniciante', 1);

-- ── CSS ───────────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('CSS', 'CSS na MDN', 'https://developer.mozilla.org/pt-BR/docs/Web/CSS', 'doc', 'pt', 1, 'iniciante', 1),
('CSS', 'Curso de HTML5 e CSS3 — Curso em Vídeo', 'https://www.cursoemvideo.com/curso/html5-css3/', 'curso', 'pt', 1, 'iniciante', 1),
('CSS', 'Responsive Web Design — freeCodeCamp (pt)', 'https://www.freecodecamp.org/portuguese/learn/responsive-web-design/', 'curso', 'pt', 1, 'iniciante', 1);

-- ── JavaScript ────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('JavaScript', 'JavaScript na MDN', 'https://developer.mozilla.org/pt-BR/docs/Web/JavaScript', 'doc', 'pt', 1, 'iniciante', 1),
('JavaScript', 'Curso de JavaScript — Curso em Vídeo', 'https://www.cursoemvideo.com/curso/javascript/', 'curso', 'pt', 1, 'iniciante', 1),
('JavaScript', 'JavaScript Algorithms and Data Structures — freeCodeCamp (pt)', 'https://www.freecodecamp.org/portuguese/learn/javascript-algorithms-and-data-structures/', 'curso', 'pt', 1, 'intermediario', 1);

-- ── TypeScript ────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('TypeScript', 'TypeScript Handbook (documentação oficial)', 'https://www.typescriptlang.org/docs/handbook/intro.html', 'doc', 'en', 1, 'iniciante', 1),
('TypeScript', 'TypeScript Tutorial — W3Schools', 'https://www.w3schools.com/typescript/', 'doc', 'en', 1, 'iniciante', 1),
('TypeScript', 'Learn TypeScript With This Crash Course — freeCodeCamp', 'https://www.freecodecamp.org/news/learn-typescript-with-this-crash-course/', 'curso', 'en', 1, 'intermediario', 1);

-- ── Git ───────────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Git', 'Pro Git (documentação oficial, pt-BR)', 'https://git-scm.com/book/pt-br/v2', 'doc', 'pt', 1, 'iniciante', 1),
('Git', 'Curso de Git e GitHub — Curso em Vídeo', 'https://www.cursoemvideo.com/curso/curso-de-git-e-github/', 'curso', 'pt', 1, 'iniciante', 1),
('Git', 'Git Tutorial — W3Schools', 'https://www.w3schools.com/git/', 'doc', 'en', 1, 'iniciante', 1);

-- ── React ─────────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('React', 'Documentação oficial do React (pt-BR)', 'https://pt-br.react.dev/', 'doc', 'pt', 1, 'iniciante', 1),
('React', 'Front End Development Libraries — freeCodeCamp (pt)', 'https://www.freecodecamp.org/portuguese/learn/front-end-development-libraries/', 'curso', 'pt', 1, 'intermediario', 1),
('React', 'React Tutorial — W3Schools', 'https://www.w3schools.com/react/', 'doc', 'en', 1, 'iniciante', 1);

-- ── Responsividade ────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Responsividade', 'Responsive Design na MDN', 'https://developer.mozilla.org/pt-BR/docs/Learn/CSS/CSS_layout/Responsive_Design', 'doc', 'pt', 1, 'iniciante', 1),
('Responsividade', 'Responsive Web Design — freeCodeCamp (pt)', 'https://www.freecodecamp.org/portuguese/learn/responsive-web-design/', 'curso', 'pt', 1, 'iniciante', 1),
('Responsividade', 'CSS Responsive — W3Schools', 'https://www.w3schools.com/css/css_rwd_intro.asp', 'doc', 'en', 1, 'iniciante', 1);

-- ── Acessibilidade Web ────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Acessibilidade Web', 'Acessibilidade na MDN', 'https://developer.mozilla.org/pt-BR/docs/Web/Accessibility', 'doc', 'pt', 1, 'iniciante', 1),
('Acessibilidade Web', 'Entendendo o WCAG — MDN', 'https://developer.mozilla.org/pt-BR/docs/Web/Accessibility/Understanding_WCAG', 'doc', 'pt', 1, 'intermediario', 1),
('Acessibilidade Web', 'Accessibility Tutorial — W3Schools', 'https://www.w3schools.com/accessibility/', 'doc', 'en', 1, 'iniciante', 1);

-- ── APIs REST ─────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('APIs REST', 'REST na MDN (glossário)', 'https://developer.mozilla.org/pt-BR/docs/Glossary/REST', 'doc', 'pt', 1, 'iniciante', 1),
('APIs REST', 'Back End Development and APIs — freeCodeCamp (pt)', 'https://www.freecodecamp.org/portuguese/learn/back-end-development-and-apis/', 'curso', 'pt', 1, 'intermediario', 1),
('APIs REST', 'Web APIs Introduction — W3Schools', 'https://www.w3schools.com/js/js_api_intro.asp', 'doc', 'en', 1, 'iniciante', 1);

-- ── Node.js ───────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Node.js', 'Documentação oficial do Node.js', 'https://nodejs.org/en/docs/', 'doc', 'en', 1, 'iniciante', 1),
('Node.js', 'Node.js Course for Beginners — freeCodeCamp', 'https://www.freecodecamp.org/news/nodejs-course/', 'curso', 'en', 1, 'iniciante', 1),
('Node.js', 'Node.js Tutorial — W3Schools', 'https://www.w3schools.com/nodejs/', 'doc', 'en', 1, 'iniciante', 1);

-- ── SQL ───────────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('SQL', 'SQL Tutorial — W3Schools', 'https://www.w3schools.com/sql/', 'doc', 'en', 1, 'iniciante', 1),
('SQL', 'Curso de MySQL — Curso em Vídeo', 'https://www.cursoemvideo.com/curso/mysql/', 'curso', 'pt', 1, 'iniciante', 1),
('SQL', 'Relational Database — freeCodeCamp (pt)', 'https://www.freecodecamp.org/portuguese/learn/relational-database/', 'curso', 'pt', 1, 'intermediario', 1);

-- ── Autenticação e Segurança Básica ───────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Autenticação e Segurança Básica', 'Segurança na Web — MDN', 'https://developer.mozilla.org/pt-BR/docs/Web/Security', 'doc', 'pt', 1, 'iniciante', 1),
('Autenticação e Segurança Básica', 'Autenticação HTTP — MDN', 'https://developer.mozilla.org/pt-BR/docs/Web/HTTP/Authentication', 'doc', 'pt', 1, 'intermediario', 1),
('Autenticação e Segurança Básica', 'Introdução ao JWT (documentação oficial)', 'https://jwt.io/introduction', 'doc', 'en', 1, 'intermediario', 1);

-- ── Docker ────────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Docker', 'Get Started (documentação oficial do Docker)', 'https://docs.docker.com/get-started/', 'doc', 'en', 1, 'iniciante', 1),
('Docker', 'Docker Full Course — freeCodeCamp', 'https://www.freecodecamp.org/news/docker-full-course', 'curso', 'en', 1, 'iniciante', 1),
('Docker', 'The Docker Handbook — freeCodeCamp', 'https://www.freecodecamp.org/news/the-docker-handbook/', 'curso', 'en', 1, 'intermediario', 1);

-- ── Lógica de Programação ─────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Lógica de Programação', 'Curso de Algoritmos e Lógica de Programação — Curso em Vídeo', 'https://www.cursoemvideo.com/curso/curso-de-algoritmo/', 'curso', 'pt', 1, 'iniciante', 1),
('Lógica de Programação', 'JavaScript Algorithms and Data Structures — freeCodeCamp (pt)', 'https://www.freecodecamp.org/portuguese/learn/javascript-algorithms-and-data-structures/', 'curso', 'pt', 1, 'intermediario', 1),
('Lógica de Programação', 'Data Structures and Algorithms — W3Schools', 'https://www.w3schools.com/dsa/', 'doc', 'en', 1, 'intermediario', 1);

-- ── Python ────────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Python', 'Tutorial oficial do Python (pt-BR)', 'https://docs.python.org/pt-br/3/tutorial/', 'doc', 'pt', 1, 'iniciante', 1),
('Python', 'Curso de Python — Curso em Vídeo', 'https://www.cursoemvideo.com/curso/python-3-mundo-1/', 'curso', 'pt', 1, 'iniciante', 1),
('Python', 'Scientific Computing with Python — freeCodeCamp (pt)', 'https://www.freecodecamp.org/portuguese/learn/scientific-computing-with-python/', 'curso', 'pt', 1, 'intermediario', 1);

-- ── Estatística Básica ────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Estatística Básica', 'Data Analysis with Python — freeCodeCamp (pt)', 'https://www.freecodecamp.org/portuguese/learn/data-analysis-with-python/', 'curso', 'pt', 1, 'iniciante', 1),
('Estatística Básica', 'Statistics Tutorial — W3Schools', 'https://www.w3schools.com/statistics/', 'doc', 'en', 1, 'iniciante', 1),
('Estatística Básica', 'Stats tutorial (documentação oficial do SciPy)', 'https://docs.scipy.org/doc/scipy/tutorial/stats.html', 'doc', 'en', 1, 'intermediario', 1);

-- ── Pandas ────────────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Pandas', 'Documentação oficial do Pandas', 'https://pandas.pydata.org/docs/', 'doc', 'en', 1, 'intermediario', 1),
('Pandas', 'Data Analysis with Python — freeCodeCamp (pt)', 'https://www.freecodecamp.org/portuguese/learn/data-analysis-with-python/', 'curso', 'pt', 1, 'iniciante', 1),
('Pandas', 'Pandas Tutorial — W3Schools', 'https://www.w3schools.com/python/pandas/default.asp', 'doc', 'en', 1, 'iniciante', 1);

-- ── Visualização de Dados ─────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Visualização de Dados', 'Tutoriais oficiais do Matplotlib', 'https://matplotlib.org/stable/tutorials/index.html', 'doc', 'en', 1, 'intermediario', 1),
('Visualização de Dados', 'Learn Data Visualization Using D3.js — freeCodeCamp', 'https://www.freecodecamp.org/news/data-visualization-using-d3-course/', 'curso', 'en', 1, 'intermediario', 1),
('Visualização de Dados', 'Matplotlib Intro — W3Schools', 'https://www.w3schools.com/python/matplotlib_intro.asp', 'doc', 'en', 1, 'iniciante', 1);

-- ── Excel Avançado ────────────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Excel Avançado', 'Suporte oficial do Excel (Microsoft, pt-BR)', 'https://support.microsoft.com/pt-br/excel', 'doc', 'pt', 1, 'iniciante', 1),
('Excel Avançado', 'Curso de Excel — Curso em Vídeo', 'https://www.cursoemvideo.com/curso/excell/', 'curso', 'pt', 1, 'iniciante', 1),
('Excel Avançado', 'Learn Microsoft Excel — freeCodeCamp', 'https://www.freecodecamp.org/news/learn-microsoft-excel/', 'curso', 'en', 1, 'intermediario', 1);

-- ── Testes Automatizados ──────────────────────────────────
INSERT IGNORE INTO recursos (habilidade, titulo, url, tipo, idioma, gratuito, nivel, ativo) VALUES
('Testes Automatizados', 'Documentação oficial do Jest (pt-BR)', 'https://jestjs.io/pt-BR/', 'doc', 'pt', 1, 'iniciante', 1),
('Testes Automatizados', 'Quality Assurance — freeCodeCamp (pt)', 'https://www.freecodecamp.org/portuguese/learn/quality-assurance/', 'curso', 'pt', 1, 'intermediario', 1),
('Testes Automatizados', 'Documentação oficial da Testing Library', 'https://testing-library.com/docs/', 'doc', 'en', 1, 'intermediario', 1);
