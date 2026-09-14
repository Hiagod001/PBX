const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const COLORS = {
  brand: "#b91c1c",
  brandDark: "#7f1d1d",
  ink: "#18181b",
  muted: "#71717a",
  line: "#d4d4d8",
  soft: "#f4f4f5",
  paper: "#ffffff",
  success: "#166534",
  warning: "#9a3412"
};

function dateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo"
  }).format(date);
}

function dateOnly(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function clean(value, fallback = "-") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function filterDescription(filters = {}) {
  const labels = {
    number: "Numero", extension: "Ramal", extensionName: "Nome", type: "Tipo", status: "Status",
    trunk: "Tronco", queue: "Fila", did: "DID", recording: "Gravacao", department: "Setor",
    protocol: "Protocolo", q: "Pesquisa", timeStart: "Hora inicial", timeEnd: "Hora final"
  };
  return Object.entries(labels)
    .filter(([key]) => String(filters[key] || "").trim())
    .map(([key, label]) => `${label}: ${filters[key]}`)
    .join("  |  ") || "Nenhum filtro adicional";
}

function buildReportPdf({ calls, dashboard, companyName, filters, requestedBy, roleLabel, generatedAt = new Date() }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margins: { top: 34, right: 36, bottom: 42, left: 36 }, bufferPages: true, info: {
      Title: "Relatorio de chamadas - UAI PBX",
      Author: requestedBy,
      Subject: "Relatorio operacional de chamadas"
    } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 72;
    const logoPath = path.join(__dirname, "..", "public", "assets", "icon.png");
    const emittedAt = dateTime(generatedAt);
    const period = `${dateOnly(filters.dateStart) === "-" ? "Inicio dos registros" : dateOnly(filters.dateStart)} ate ${dateOnly(filters.dateEnd) === "-" ? "agora" : dateOnly(filters.dateEnd)}`;
    const columns = [
      { label: "Data e hora", key: "startedAt", width: 115 },
      { label: "Protocolo", key: "protocol", width: 90 },
      { label: "Origem", key: "source", width: 110 },
      { label: "Destino", key: "destination", width: 110 },
      { label: "Ramal", key: "extension", width: 55 },
      { label: "Tipo", key: "typeLabel", width: 65 },
      { label: "Status", key: "statusLabel", width: 90 },
      { label: "Fila", key: "queue", width: 55 },
      { label: "Duracao", key: "durationLabel", width: 80 }
    ];
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

    function drawPageHeader(firstPage = false) {
      if (fs.existsSync(logoPath)) doc.image(logoPath, 36, 28, { width: 42, height: 42 });
      doc.fillColor(COLORS.brandDark).font("Helvetica-Bold").fontSize(15).text("UAI PBX", 88, 30);
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(clean(companyName, "Telefonia empresarial"), 88, 50);
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(firstPage ? 20 : 13)
        .text(firstPage ? "Relatorio de chamadas" : "Relatorio de chamadas - continuacao", 390, firstPage ? 31 : 38, { width: 415, align: "right" });
      doc.moveTo(36, 78).lineTo(pageWidth - 36, 78).lineWidth(1.2).strokeColor(COLORS.brand).stroke();
      doc.y = 92;
    }

    function drawMeta() {
      const meta = [
        ["Periodo analisado", period],
        ["Emitido em", emittedAt],
        ["Solicitado por", `${clean(requestedBy)} (${clean(roleLabel, "Usuario")})`]
      ];
      meta.forEach(([label, value], index) => {
        const x = 36 + index * 255;
        doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7).text(label.toUpperCase(), x, 94, { width: 230 });
        doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9).text(value, x, 106, { width: 230 });
      });
      doc.y = 132;
    }

    function drawSummary() {
      const cards = [
        ["Total de chamadas", dashboard.total, COLORS.ink],
        ["Atendidas", dashboard.answered, COLORS.success],
        ["Nao atendidas", dashboard.missed, COLORS.warning],
        ["Com gravacao", dashboard.recordings, COLORS.brandDark]
      ];
      const gap = 10;
      const width = (contentWidth - gap * 3) / 4;
      cards.forEach(([label, value, color], index) => {
        const x = 36 + index * (width + gap);
        doc.roundedRect(x, 136, width, 48, 4).fillAndStroke(COLORS.soft, COLORS.line);
        doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7).text(label.toUpperCase(), x + 12, 146, { width: width - 24 });
        doc.fillColor(color).font("Helvetica-Bold").fontSize(17).text(String(value ?? 0), x + 12, 159, { width: width - 24 });
      });
      doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7).text("FILTROS APLICADOS", 36, 198);
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8).text(filterDescription(filters), 36, 210, { width: contentWidth, height: 24, ellipsis: true });
      doc.y = 240;
    }

    function drawTableHeader(y) {
      doc.rect(36, y, tableWidth, 22).fill(COLORS.brandDark);
      let x = 36;
      columns.forEach((column) => {
        doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(7).text(column.label, x + 5, y + 7, { width: column.width - 10, height: 10, ellipsis: true });
        x += column.width;
      });
      return y + 22;
    }

    function rowValue(call, key) {
      if (key === "startedAt") return dateTime(call.startedAt);
      return clean(call[key]);
    }

    drawPageHeader(true);
    drawMeta();
    drawSummary();
    let y = drawTableHeader(doc.y);
    if (!calls.length) {
      doc.fillColor(COLORS.muted).font("Helvetica-Oblique").fontSize(10).text("Nenhuma chamada encontrada para os filtros selecionados.", 36, y + 18, { width: tableWidth, align: "center" });
    }
    calls.forEach((call, index) => {
      if (y + 24 > doc.page.height - 70) {
        doc.addPage({ size: "A4", layout: "landscape", margins: { top: 34, right: 36, bottom: 42, left: 36 } });
        drawPageHeader(false);
        y = drawTableHeader(92);
      }
      doc.rect(36, y, tableWidth, 20).fill(index % 2 ? COLORS.soft : COLORS.paper);
      let x = 36;
      columns.forEach((column) => {
        doc.fillColor(COLORS.ink).font("Helvetica").fontSize(7).text(rowValue(call, column.key), x + 5, y + 6, { width: column.width - 10, height: 9, ellipsis: true });
        x += column.width;
      });
      doc.moveTo(36, y + 20).lineTo(36 + tableWidth, y + 20).lineWidth(0.35).strokeColor(COLORS.line).stroke();
      y += 20;
    });

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      const footerY = doc.page.height - 28;
      doc.page.margins.bottom = 0;
      doc.moveTo(36, footerY - 6).lineTo(pageWidth - 36, footerY - 6).lineWidth(0.5).strokeColor(COLORS.line).stroke();
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7).text(`UAI PBX  |  Emitido por ${clean(requestedBy)} em ${emittedAt}`, 36, footerY, { width: 560 });
      doc.text(`Pagina ${index + 1} de ${range.count}`, pageWidth - 150, footerY, { width: 114, align: "right" });
    }
    doc.end();
  });
}

module.exports = { buildReportPdf, dateTime, filterDescription };
