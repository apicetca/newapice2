// Categorias da tela Admin → Configurações (índice e páginas de cada categoria).
// `view` = tela própria de cada categoria.
const CATEGORIAS = [
  { slug: "categorias-e-vagas", titulo: "Categorias e vagas",
    descricao: "Áreas profissionais, modalidades e níveis.", view: "admin-configuracoes-categorias" },
  { slug: "administracao-e-seguranca", titulo: "Administração e segurança",
    descricao: "Acessos, gerenciamento e histórico.", view: "admin-configuracoes-seguranca" },
];

module.exports = { CATEGORIAS, porSlug: (slug) => CATEGORIAS.find(c => c.slug === slug) };
