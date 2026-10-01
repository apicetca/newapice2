// ============================================
// services/fileTextExtractor.js
// Extrai texto de arquivos anexados pelo usuário
// (PDF, .txt, .md) — ponto único de conversão
// arquivo → texto, pra qualquer feature que
// precise mandar conteúdo de arquivo pra IA.
// ============================================
const { PDFParse } = require("pdf-parse");

const MAX_EXTRACTED_CHARS = 4000;

const SUPPORTED_MIME_TYPES = {
  "application/pdf": extractFromPdf,
  "text/plain":       extractFromPlainText,
  "text/markdown":    extractFromPlainText,
};

async function extractFromPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  const { text } = await parser.getText();
  // pdf-parse insere marcadores "-- N of M --" entre páginas — ruído
  // que não ajuda o prompt da IA a entender o conteúdo.
  return text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, "");
}

async function extractFromPlainText(buffer) {
  return buffer.toString("utf8");
}

// Retorna o texto extraído (truncado), ou lança erro se o tipo não for
// suportado ou a extração falhar (ex: PDF corrompido/protegido).
async function extractText(buffer, mimetype) {
  const extractor = SUPPORTED_MIME_TYPES[mimetype];
  if (!extractor) {
    throw new Error("Formato de arquivo não suportado. Envie PDF, .txt ou .md.");
  }

  const text = await extractor(buffer);
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Não foi possível extrair texto deste arquivo.");
  }

  return trimmed.slice(0, MAX_EXTRACTED_CHARS);
}

module.exports = { extractText, SUPPORTED_MIME_TYPES, MAX_EXTRACTED_CHARS };
