const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const { z } = require("zod");
const { buildBusinessReport } = require("./operations.controller");

const exportInput = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  format: z.enum(["pdf", "xlsx", "csv"]),
});

const shortDate = (value) => new Date(value).toLocaleDateString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
});
const dateTime = (value) => new Date(value).toLocaleString("en-IN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
});
const money = (paise) => `Rs ${((Number(paise) || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fileDate = (value) => new Date(value).toISOString().slice(0, 10);
const safeFilePart = (value) => String(value || "studio").replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

function reportMeta(auth, input) {
  return {
    studioName: auth.studio.name || "Tailo360 Studio",
    address: auth.studio.address || "",
    currency: auth.studio.settings?.currency || "INR",
    from: input.from,
    to: input.to,
    generatedAt: new Date(),
    generatedBy: auth.user.name || auth.user.phone || auth.user.email || "Studio owner",
  };
}

function topGarments(report) {
  return Object.entries(report.garments || {})
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.revenuePaise - a.revenuePaise);
}

function pdfFor(report, meta) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true, info: { Title: `${meta.studioName} Business Report` } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const purple = "#5536E8", orange = "#FF7300", ink = "#171A2E", muted = "#6E738A", border = "#E6E7EF", soft = "#F6F5FC", green = "#16865A";
    const left = 42, width = 511;
    const ensure = (height = 60) => { if (doc.y + height > 770) doc.addPage(); };
    const heading = (title) => { ensure(45); doc.moveDown(.7).fillColor(purple).font("Helvetica-Bold").fontSize(12).text(title.toUpperCase(), { characterSpacing: .7 }); doc.moveDown(.5); };
    const tableHeader = (columns) => {
      ensure(34); const y = doc.y; doc.roundedRect(left, y, width, 24, 4).fill(purple);
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.5);
      columns.forEach((column) => doc.text(column.label, column.x, y + 8, { width: column.width, align: column.align || "left" }));
      doc.y = y + 31;
    };
    const tableRow = (values, columns) => {
      ensure(28); const y = doc.y; doc.fillColor(ink).font("Helvetica").fontSize(7.5);
      columns.forEach((column, index) => doc.text(String(values[index] ?? ""), column.x, y, { width: column.width, align: column.align || "left", height: 20, ellipsis: true }));
      doc.moveTo(left, y + 22).lineTo(left + width, y + 22).strokeColor(border).lineWidth(.5).stroke(); doc.y = y + 27;
    };

    doc.rect(0, 0, 595, 8).fill(purple); doc.rect(0, 8, 595, 3).fill(orange);
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(22).text("Business Report", left, 40);
    doc.fillColor(purple).fontSize(15).text(meta.studioName, left, 70);
    doc.fillColor(muted).font("Helvetica").fontSize(8.5).text(meta.address, left, 92, { width: 315 });
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(9).text(`${shortDate(meta.from)} - ${shortDate(meta.to)}`, 370, 48, { width: 183, align: "right" });
    doc.fillColor(muted).font("Helvetica").fontSize(7.5).text(`Generated ${dateTime(meta.generatedAt)}\nBy ${meta.generatedBy}`, 370, 68, { width: 183, align: "right" });
    doc.y = 125;

    heading("Executive summary");
    const change = report.comparison?.revenuePercent || 0;
    doc.fillColor(ink).font("Helvetica").fontSize(9).text(
      `${report.orders} orders were recorded during this period with ${money(report.bookedSalesPaise)} in booked sales and ${money(report.netRevenuePaise)} in net collections. ` +
      `The order completion rate was ${report.completionRate}% across ${report.uniqueCustomers} unique customers. Collections were ${Math.abs(change)}% ${change >= 0 ? "higher" : "lower"} than the preceding equivalent period.`,
      { lineGap: 3 },
    );

    heading("Key performance indicators");
    const cards = [
      ["NET COLLECTIONS", money(report.netRevenuePaise), green], ["BOOKED SALES", money(report.bookedSalesPaise), purple],
      ["ORDERS", report.orders, ink], ["AVG. ORDER", money(report.averageOrderPaise), orange],
      ["OUTSTANDING", money(report.outstandingPaise), orange], ["COMPLETION", `${report.completionRate}%`, green],
    ];
    cards.forEach((card, index) => {
      const column = index % 3, row = Math.floor(index / 3), x = left + column * 173, y = doc.y + row * 57;
      doc.roundedRect(x, y, 162, 47, 7).fill(soft);
      doc.fillColor(muted).font("Helvetica-Bold").fontSize(6.5).text(card[0], x + 10, y + 9, { characterSpacing: .5 });
      doc.fillColor(card[2]).fontSize(12).text(String(card[1]), x + 10, y + 23, { width: 142, ellipsis: true });
    });
    doc.y += 120;

    const daily = report.daily || [];
    if (daily.length) {
      heading("Collection trend");
      const chartY = doc.y, chartHeight = 82, chartWidth = width;
      const max = Math.max(1, ...daily.map((row) => Math.abs(row.collectedPaise || 0)));
      const shown = daily.length > 31 ? daily.filter((_, index) => index % Math.ceil(daily.length / 31) === 0) : daily;
      const gap = 2, barWidth = Math.max(2, (chartWidth - gap * shown.length) / shown.length);
      doc.rect(left, chartY, chartWidth, chartHeight).fill("#FAFAFD");
      shown.forEach((row, index) => {
        const height = Math.max(1, Math.abs(row.collectedPaise || 0) / max * 64);
        doc.rect(left + index * (barWidth + gap), chartY + chartHeight - height - 8, barWidth, height).fill(row.collectedPaise < 0 ? orange : purple);
      });
      doc.y = chartY + chartHeight + 8;
    }

    const garments = topGarments(report);
    heading("Service performance");
    const garmentColumns = [{ label: "SERVICE", x: left + 8, width: 230 }, { label: "ORDERS", x: 300, width: 60, align: "right" }, { label: "PIECES", x: 375, width: 60, align: "right" }, { label: "BOOKED SALES", x: 445, width: 100, align: "right" }];
    tableHeader(garmentColumns);
    garments.slice(0, 12).forEach((item) => tableRow([item.name, item.orders, item.quantity, money(item.revenuePaise)], garmentColumns));
    if (!garments.length) doc.fillColor(muted).fontSize(9).text("No garment performance data for this period.");

    heading("Top customers");
    const customerColumns = [{ label: "CUSTOMER", x: left + 8, width: 235 }, { label: "ORDERS", x: 330, width: 60, align: "right" }, { label: "BOOKED VALUE", x: 420, width: 125, align: "right" }];
    tableHeader(customerColumns);
    (report.topCustomers || []).forEach((item) => tableRow([item.name, item.orders, money(item.valuePaise)], customerColumns));
    if (!report.topCustomers?.length) doc.fillColor(muted).fontSize(9).text("No customer activity for this period.");

    heading("Order detail");
    const orderColumns = [{ label: "ORDER", x: left + 6, width: 75 }, { label: "CUSTOMER", x: 120, width: 130 }, { label: "DATE", x: 255, width: 75 }, { label: "STATUS", x: 330, width: 80 }, { label: "TOTAL", x: 410, width: 65, align: "right" }, { label: "BALANCE", x: 480, width: 67, align: "right" }];
    tableHeader(orderColumns);
    (report.orderRows || []).forEach((order) => tableRow([order.code, order.customerId?.name || "Customer", shortDate(order.createdAt), String(order.status).replaceAll("_", " "), money(order.totalPaise), money(order.outstandingPaise)], orderColumns));
    if (!report.orderRows?.length) doc.fillColor(muted).fontSize(9).text("No orders were recorded in this period.");

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index++) {
      doc.switchToPage(index);
      doc.moveTo(left, 796).lineTo(left + width, 796).strokeColor(border).lineWidth(.5).stroke();
      doc.fillColor(muted).font("Helvetica").fontSize(7).text("Tailo360 business report", left, 806, { width: 250 });
      doc.text(`Page ${index + 1} of ${range.count}`, 400, 806, { width: 153, align: "right" });
    }
    doc.end();
  });
}

function styleSheet(sheet, widths) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + widths.length)}1` };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5536E8" } };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.getRow(1).height = 24;
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.eachRow((row, rowNumber) => { if (rowNumber > 1 && rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F5FC" } }; });
}

async function xlsxFor(report, meta) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tailo360"; workbook.created = meta.generatedAt;
  const summary = workbook.addWorksheet("Executive Summary");
  summary.addRows([
    ["BUSINESS REPORT", meta.studioName], ["Reporting period", `${shortDate(meta.from)} - ${shortDate(meta.to)}`], ["Generated", dateTime(meta.generatedAt)], ["Generated by", meta.generatedBy], [],
    ["KPI", "VALUE"], ["Net collections", report.netRevenuePaise / 100], ["Gross collections", report.collectedPaise / 100], ["Refunds", report.refundedPaise / 100], ["Booked sales", report.bookedSalesPaise / 100], ["Outstanding", report.outstandingPaise / 100], ["Orders", report.orders], ["Average order", report.averageOrderPaise / 100], ["Completion rate", report.completionRate / 100], ["Unique customers", report.uniqueCustomers], ["Repeat customers", report.repeatCustomers], ["Revenue change", (report.comparison?.revenuePercent || 0) / 100], ["Order change", (report.comparison?.ordersPercent || 0) / 100],
  ]);
  summary.getColumn(1).width = 28; summary.getColumn(2).width = 34;
  summary.getRow(1).font = { bold: true, size: 16, color: { argb: "FF5536E8" } };
  summary.getRow(6).font = { bold: true, color: { argb: "FFFFFFFF" } }; summary.getRow(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5536E8" } };
  [7, 8, 9, 10, 11, 13].forEach((row) => { summary.getCell(row, 2).numFmt = '[$Rs-en-IN] #,##0.00'; });
  [14, 17, 18].forEach((row) => { summary.getCell(row, 2).numFmt = "0.0%"; });

  const orders = workbook.addWorksheet("Orders");
  orders.addRow(["Order", "Customer", "Phone", "Order date", "Delivery date", "Status", "Garments", "Total", "Paid", "Outstanding"]);
  (report.orderRows || []).forEach((order) => orders.addRow([order.code, order.customerId?.name || "Customer", order.customerId?.phone || "", new Date(order.createdAt), new Date(order.deliveryDate), order.status, (order.lines || []).map((line) => `${line.quantity} ${line.name}`).join(", "), order.totalPaise / 100, order.paidPaise / 100, order.outstandingPaise / 100]));
  orders.addRow(["TOTAL", "", "", "", "", "", "", { formula: `SUM(H2:H${Math.max(2, orders.rowCount)})` }, { formula: `SUM(I2:I${Math.max(2, orders.rowCount)})` }, { formula: `SUM(J2:J${Math.max(2, orders.rowCount)})` }]);
  styleSheet(orders, [16, 24, 17, 15, 15, 20, 38, 15, 15, 15]);
  [8, 9, 10].forEach((column) => { orders.getColumn(column).numFmt = '[$Rs-en-IN] #,##0.00'; });
  [4, 5].forEach((column) => { orders.getColumn(column).numFmt = "dd mmm yyyy"; });

  const payments = workbook.addWorksheet("Payments");
  payments.addRow(["Date", "Order", "Customer", "Direction", "Method", "Amount", "Note"]);
  (report.paymentRows || []).forEach((payment) => payments.addRow([new Date(payment.recordedAt), payment.orderCode, payment.customerName, payment.direction, payment.method, payment.amountPaise / 100, payment.note]));
  payments.addRow(["TOTAL NET", "", "", "", "", report.netRevenuePaise / 100, ""]);
  styleSheet(payments, [20, 16, 24, 14, 14, 16, 34]); payments.getColumn(1).numFmt = "dd mmm yyyy hh:mm"; payments.getColumn(6).numFmt = '[$Rs-en-IN] #,##0.00';

  const services = workbook.addWorksheet("Services");
  services.addRow(["Garment / service", "Orders", "Pieces", "Booked sales"]);
  topGarments(report).forEach((item) => services.addRow([item.name, item.orders, item.quantity, item.revenuePaise / 100]));
  styleSheet(services, [30, 14, 14, 20]); services.getColumn(4).numFmt = '[$Rs-en-IN] #,##0.00';

  const trend = workbook.addWorksheet("Daily Trend");
  trend.addRow(["Date", "Orders", "Booked sales", "Net collections"]);
  (report.daily || []).forEach((row) => trend.addRow([new Date(`${row.date}T00:00:00+05:30`), row.orders, row.bookedPaise / 100, row.collectedPaise / 100]));
  styleSheet(trend, [16, 14, 20, 20]); trend.getColumn(1).numFmt = "dd mmm yyyy"; [3, 4].forEach((column) => { trend.getColumn(column).numFmt = '[$Rs-en-IN] #,##0.00'; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function csvEscape(value) {
  const string = value == null ? "" : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}
function csvFor(report, meta) {
  const rows = [
    ["Tailo360 Business Report"], ["Studio", meta.studioName], ["Period", `${shortDate(meta.from)} - ${shortDate(meta.to)}`], ["Generated", dateTime(meta.generatedAt)], [],
    ["SUMMARY"], ["Net collections", money(report.netRevenuePaise)], ["Booked sales", money(report.bookedSalesPaise)], ["Orders", report.orders], ["Average order", money(report.averageOrderPaise)], ["Outstanding", money(report.outstandingPaise)], ["Completion rate", `${report.completionRate}%`], [],
    ["ORDER DETAILS"], ["Order", "Customer", "Phone", "Order date", "Delivery date", "Status", "Garments", "Total", "Paid", "Outstanding"],
    ...(report.orderRows || []).map((order) => [order.code, order.customerId?.name || "Customer", order.customerId?.phone || "", shortDate(order.createdAt), shortDate(order.deliveryDate), order.status, (order.lines || []).map((line) => `${line.quantity} ${line.name}`).join("; "), money(order.totalPaise), money(order.paidPaise), money(order.outstandingPaise)]),
  ];
  return Buffer.from(`\uFEFF${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}`, "utf8");
}

async function exportReport(req, res) {
  const input = exportInput.parse(req.query);
  const report = await buildBusinessReport(req.auth, input, { includeDetails: true });
  const meta = reportMeta(req.auth, input);
  const generators = { pdf: () => pdfFor(report, meta), xlsx: () => xlsxFor(report, meta), csv: () => csvFor(report, meta) };
  const contentTypes = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv; charset=utf-8" };
  const buffer = await generators[input.format]();
  const fileName = `${safeFilePart(meta.studioName)}-business-report-${fileDate(input.from)}-to-${fileDate(input.to)}.${input.format}`;
  res.set({ "Content-Type": contentTypes[input.format], "Content-Disposition": `attachment; filename="${fileName}"`, "Content-Length": buffer.length, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  res.send(buffer);
}

module.exports = { exportReport, pdfFor, xlsxFor, csvFor };
