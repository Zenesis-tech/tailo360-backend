const ExcelJS = require("exceljs");
const { pdfFor, xlsxFor, csvFor } = require("../src/controllers/report-export.controller");

const meta = {
  studioName: "Needle & Thread",
  address: "Pune, Maharashtra",
  currency: "INR",
  from: new Date("2026-08-01T00:00:00.000Z"),
  to: new Date("2026-08-31T23:59:59.999Z"),
  generatedAt: new Date("2026-09-01T05:00:00.000Z"),
  generatedBy: "Studio Owner",
};

function report(orderCount = 1) {
  const orderRows = Array.from({ length: orderCount }, (_, index) => ({
    _id: `order-${index}`,
    code: `TL-${index + 1}`,
    customerId: { name: `Customer ${index + 1}`, phone: "+919000000000" },
    createdAt: new Date("2026-08-10T10:00:00.000Z"),
    deliveryDate: new Date("2026-08-20T10:00:00.000Z"),
    status: "delivered",
    lines: [{ name: "Kurti", quantity: 1 }],
    totalPaise: 250000,
    paidPaise: 200000,
    outstandingPaise: 50000,
  }));
  return {
    collectedPaise: 200000,
    refundedPaise: 10000,
    netRevenuePaise: 190000,
    bookedSalesPaise: 250000 * orderCount,
    outstandingPaise: 50000 * orderCount,
    orders: orderCount,
    averageOrderPaise: orderCount ? 250000 : 0,
    completionRate: orderCount ? 100 : 0,
    uniqueCustomers: orderCount,
    repeatCustomers: 0,
    comparison: { revenuePercent: 12.5, ordersPercent: 10 },
    garments: orderCount ? { Kurti: { orders: orderCount, quantity: orderCount, revenuePaise: 250000 * orderCount } } : {},
    topCustomers: orderCount ? [{ name: "Customer 1", orders: 1, valuePaise: 250000 }] : [],
    daily: orderCount ? [{ date: "2026-08-10", orders: orderCount, bookedPaise: 250000 * orderCount, collectedPaise: 190000 }] : [],
    orderRows,
    paymentRows: orderCount ? [{ recordedAt: new Date("2026-08-10T10:00:00.000Z"), orderCode: "TL-1", customerName: "Customer 1", direction: "collection", method: "upi", amountPaise: 200000, note: "Advance" }] : [],
  };
}

test("business PDF is a paginated professional PDF", async () => {
  const buffer = await pdfFor(report(75), meta);
  expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  expect(buffer.length).toBeGreaterThan(5000);
});

test("business XLSX opens with structured sheets and totals", async () => {
  const buffer = await xlsxFor(report(3), meta);
  expect(buffer.subarray(0, 2).toString()).toBe("PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    "Executive Summary", "Orders", "Payments", "Services", "Daily Trend",
  ]);
  expect(workbook.getWorksheet("Orders").rowCount).toBe(5);
});

test("CSV is UTF-8, escaped, and contains authoritative detail", () => {
  const buffer = csvFor(report(1), meta);
  const csv = buffer.toString("utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain("ORDER DETAILS");
  expect(csv).toContain("TL-1");
  expect(csv).toContain("Rs 2,500.00");
});

test("all formats support an empty-data report", async () => {
  const empty = report(0);
  expect((await pdfFor(empty, meta)).subarray(0, 4).toString()).toBe("%PDF");
  expect((await xlsxFor(empty, meta)).length).toBeGreaterThan(1000);
  expect(csvFor(empty, meta).toString("utf8")).toContain("Orders,0");
});
