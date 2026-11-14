// ============================================
// services/relatorioExport.js
// Exportação dos relatórios do admin para PDF (pdfkit) e Excel (exceljs).
//
// Os dois formatos recebem a mesma estrutura:
//   { titulo, descricao, periodo, secoes: [{ titulo, colunas: [..], linhas: [[..]] }] }
// Em `linhas`, números viram células numéricas no Excel; a 1ª coluna é o rótulo.
// ============================================
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const MIME = {
  pdf:  "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// Excel: nome de aba até 31 caracteres, sem  \ / ? * [ ] :
const nomeAba = (s, usados) => {
  let base = String(s).replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Dados";
  let nome = base, i = 2;
  while (usados.has(nome.toLowerCase())) nome = `${base.slice(0, 28)} ${i++}`;
  usados.add(nome.toLowerCase());
  return nome;
};

async function gerarXlsx(rel) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ápice";
  wb.created = new Date();
  const usados = new Set();

  for (const secao of rel.secoes) {
    const ws = wb.addWorksheet(nomeAba(secao.titulo, usados));
    ws.addRow([rel.titulo]).font = { bold: true, size: 14 };
    ws.addRow([`${secao.titulo}${rel.periodo ? ` — ${rel.periodo}` : ""}`]);
    ws.addRow([]);
    const cab = ws.addRow(secao.colunas);
    cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cab.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF222222" } }; });
    secao.linhas.forEach(l => ws.addRow(l));

    secao.colunas.forEach((titulo, i) => {
      const larg = Math.max(String(titulo).length, ...secao.linhas.map(l => String(l[i] ?? "").length), 8);
      ws.getColumn(i + 1).width = Math.min(larg + 3, 60);
      if (i > 0) ws.getColumn(i + 1).alignment = { horizontal: "right" };
    });
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ──
const COR = { texto: "#111111", suave: "#555555", linha: "#cccccc", cabecalho: "#eeeeee" };
const fmtCelula = (v) => (typeof v === "number" ? new Intl.NumberFormat("pt-BR").format(v) : String(v ?? ""));

function gerarPdf(rel) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: rel.titulo, Author: "Ápice" } });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const largura = doc.page.width - 80;
    const limite = () => doc.page.height - 60;

    doc.fillColor(COR.texto).font("Helvetica-Bold").fontSize(20).text(rel.titulo);
    if (rel.descricao) doc.font("Helvetica").fontSize(10).fillColor(COR.suave).text(rel.descricao);
    if (rel.periodo) doc.fontSize(10).fillColor(COR.suave).text(`Período: ${rel.periodo}`);
    doc.moveDown(0.8);

    const linhaAltura = 20;
    for (const secao of rel.secoes) {
      if (doc.y + linhaAltura * 3 > limite()) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).fillColor(COR.texto).text(secao.titulo);
      doc.moveDown(0.3);

      const n = secao.colunas.length;
      // `larguras` (proporções) e `esquerda` (índices alinhados à esquerda) são opcionais
      const primeira = n > 3 ? largura * 0.28 : largura * 0.4;
      const resto = (largura - primeira) / Math.max(n - 1, 1);
      const largs = secao.larguras?.length === n
        ? secao.larguras.map(p => p * largura)
        : secao.colunas.map((_, i) => (i === 0 ? primeira : resto));
      const xs = largs.reduce((acc, w, i) => (acc.push(i ? acc[i - 1] + largs[i - 1] : 40), acc), []);

      const desenhar = (cells, cabecalho) => {
        if (doc.y + linhaAltura > limite()) { doc.addPage(); }
        const y = doc.y;
        if (cabecalho) doc.rect(40, y, largura, linhaAltura).fill(COR.cabecalho);
        doc.fillColor(COR.texto).font(cabecalho ? "Helvetica-Bold" : "Helvetica").fontSize(9);
        cells.forEach((c, i) => {
          doc.text(fmtCelula(c), xs[i] + 5, y + 6, {
            width: largs[i] - 10, height: linhaAltura - 6, lineBreak: false, ellipsis: true,
            align: i === 0 || secao.esquerda?.includes(i) ? "left" : "right",
          });
        });
        doc.moveTo(40, y + linhaAltura).lineTo(40 + largura, y + linhaAltura).strokeColor(COR.linha).lineWidth(0.5).stroke();
        doc.y = y + linhaAltura;
      };

      desenhar(secao.colunas, true);
      if (!secao.linhas.length) desenhar(["Sem dados no período."], false);
      secao.linhas.forEach(l => desenhar(l, false));
      doc.x = 40;
      doc.moveDown(1);
    }

    doc.font("Helvetica").fontSize(8).fillColor(COR.suave)
      .text(`Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, 40, doc.y, { width: largura });
    if (rel.nota) doc.moveDown(0.3).text(rel.nota, 40, doc.y, { width: largura });
    doc.end();
  });
}

async function exportar(rel, formato) {
  if (formato === "pdf")  return { buffer: await gerarPdf(rel),  mime: MIME.pdf,  ext: "pdf" };
  if (formato === "xlsx") return { buffer: await gerarXlsx(rel), mime: MIME.xlsx, ext: "xlsx" };
  throw Object.assign(new Error("Formato inválido. Use pdf ou xlsx."), { status: 400 });
}

module.exports = { gerarPdf, gerarXlsx, exportar, MIME };
