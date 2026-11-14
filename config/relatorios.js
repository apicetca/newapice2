// Categorias da tela Admin → Relatórios (índice e páginas de detalhe).
// `secoes` diz quais blocos de /api/admin/reports cada categoria mostra; uma
// categoria sem seções ainda não tem relatório disponível.
const CATEGORIAS = [
  { slug: "crescimento-de-usuarios", icon: "usuarios", titulo: "Crescimento de usuários",
    descricao: "Cadastros e usuários ativos.", secoes: [], view: "admin-relatorio-crescimento" },
  { slug: "desempenho-das-vagas", icon: "vagas", titulo: "Desempenho das vagas",
    descricao: "Vagas por categoria e modalidade.", secoes: [], view: "admin-relatorio-desempenho" },
  { slug: "compatibilidade-de-matchs", icon: "matchs", titulo: "Compatibilidade de matchs",
    descricao: "Percentuais de compatibilidade.", secoes: [], view: "admin-relatorio-matchs" },
  { slug: "atividade-das-empresas", icon: "empresas", titulo: "Atividade das empresas",
    descricao: "Empresas e oportunidades publicadas.", secoes: [], view: "admin-relatorio-empresas" },
  { slug: "uso-da-plataforma", icon: "uso", titulo: "Uso da plataforma",
    descricao: "Acessos e pesquisas realizadas.", secoes: [], view: "admin-relatorio-uso" },
  { slug: "planos-e-assinaturas", icon: "planos", titulo: "Planos e assinaturas",
    descricao: "Acompanhe os planos utilizados na Ápice.", secoes: [], view: "admin-relatorio-planos" },
];

module.exports = { CATEGORIAS, porSlug: (slug) => CATEGORIAS.find(c => c.slug === slug) };
