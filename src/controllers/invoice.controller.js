const PDFDocument = require('pdfkit');
const { nanoid } = require('nanoid');
const { Order, Media } = require('../models');
const r2 = require('../services/r2.service');
const { notFound } = require('../utils/errors');

const money = (paise) => `Rs ${(paise / 100).toFixed(2)}`;
const paidFor = (order) => order.payments.reduce(
  (sum, payment) => sum + (payment.direction === 'collection' ? payment.amountPaise : -payment.amountPaise),
  0,
);

function pdfFor(order, studio) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const parts = [];
    doc.on('data', (part) => parts.push(part));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.on('error', reject);

    const left = 48;
    const right = 547;
    const purple = '#5B3EFF';
    const ink = '#1A1D1E';
    const muted = '#687076';
    const border = '#EAECEE';

    doc.rect(0, 0, 595, 132).fill(purple);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(23)
      .text(studio.name || 'Tailo360 Studio', left, 42, { width: 310 });
    doc.fillColor('#DED8FF').font('Helvetica').fontSize(10)
      .text('MADE TO MEASURE, MADE WITH CARE', left, 74);
    doc.fillColor('#DED8FF').font('Helvetica-Bold').fontSize(9)
      .text('INVOICE', 390, 42, { width: 157, align: 'right' });
    doc.fillColor('#FFFFFF').fontSize(18)
      .text(order.code, 390, 59, { width: 157, align: 'right' });

    let y = 166;
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('BILLED TO', left, y);
    doc.fillColor(ink).fontSize(13).text(order.customerId.name, left, y + 16);
    doc.fillColor(muted).font('Helvetica').fontSize(9).text(order.customerId.phone, left, y + 35);
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(8)
      .text('ORDER DATES', 355, y, { width: 192, align: 'right' });
    doc.fillColor(ink).font('Helvetica').fontSize(9)
      .text(`Placed: ${new Date(order.orderDate).toLocaleDateString('en-IN')}`, 355, y + 16, { width: 192, align: 'right' })
      .text(`Delivery: ${new Date(order.deliveryDate).toLocaleDateString('en-IN')}`, 355, y + 31, { width: 192, align: 'right' });

    y += 70;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(border).stroke();
    y += 16;
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(8)
      .text('ITEM', left, y)
      .text('QTY', 350, y, { width: 45, align: 'center' })
      .text('AMOUNT', 430, y, { width: 117, align: 'right' });
    y += 22;

    order.lines.forEach((line) => {
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(10)
        .text(line.name, left, y, { width: 280 });
      doc.fillColor(muted).font('Helvetica').fontSize(8)
        .text(`${money(line.unitPricePaise)} each`, left, y + 15, { width: 280 });
      doc.fillColor(ink).fontSize(10)
        .text(String(line.quantity), 350, y + 4, { width: 45, align: 'center' })
        .text(money(line.lineTotalPaise), 430, y + 4, { width: 117, align: 'right' });
      y += 40;
      doc.moveTo(left, y).lineTo(right, y).strokeColor(border).stroke();
      y += 12;
    });

    const paid = paidFor(order);
    const summaryX = 337;
    doc.fillColor(muted).font('Helvetica').fontSize(10)
      .text('Subtotal', summaryX, y, { width: 100 })
      .fillColor(ink).font('Helvetica-Bold')
      .text(money(order.totalPaise), 437, y, { width: 110, align: 'right' });
    y += 21;
    doc.fillColor(muted).font('Helvetica').text('Paid', summaryX, y, { width: 100 })
      .fillColor(ink).font('Helvetica-Bold')
      .text(money(paid), 437, y, { width: 110, align: 'right' });
    y += 28;
    doc.roundedRect(summaryX - 12, y - 10, 222, 46, 8).fill('#F0EDFF');
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(11)
      .text('BALANCE DUE', summaryX, y + 5, { width: 100 })
      .fillColor(purple).fontSize(15)
      .text(money(order.totalPaise - paid), 437, y + 2, { width: 98, align: 'right' });

    y += 78;
    if (order.notes) {
      doc.roundedRect(left, y, right - left, 48, 8).fill('#F8F9FF');
      doc.fillColor(muted).font('Helvetica').fontSize(9)
        .text(`Order note: ${order.notes}`, left + 13, y + 13, { width: right - left - 26, height: 28 });
    }
    doc.fillColor(purple).font('Helvetica-Bold').fontSize(11)
      .text('Thank you for choosing us.', left, 760, { width: right - left, align: 'center' });
    doc.end();
  });
}

async function createInvoiceFile(order, auth) {
  const buffer = await pdfFor(order, auth.studio);
  const key = `${auth.studio._id}/invoices/${order.code}-${nanoid(10)}.pdf`;
  await r2.putObject({ key, body: buffer, contentType: 'application/pdf' });
  const media = await Media.create({ studioId: auth.studio._id, ownerUserId: auth.user._id, objectKey: key, originalName: `${order.code}.pdf`, contentType: 'application/pdf', sizeBytes: buffer.length, purpose: 'invoice_pdf', status: 'ready' });
  return { media, url: await r2.createReadUrl(key) };
}

async function invoice(req, res) {
  const order = await Order.findOne({ _id: req.params.id, studioId: req.auth.studio._id, deletedAt: null })
    .populate('customerId', 'name phone');
  if (!order) throw notFound('Order');
  const { media, url } = await createInvoiceFile(order, req.auth);
  order.activity.push({ type: 'invoice_generated', actorId: req.auth.user._id, note: `Invoice PDF generated: ${media.id}` });
  await order.save();
  res.json({ data: { mediaId: media.id, downloadUrl: url, expiresInSeconds: 900 } });
}

async function share(req, res) {
  const order = await Order.findOne({ _id: req.params.id, studioId: req.auth.studio._id, deletedAt: null })
    .populate('customerId', 'name phone');
  if (!order) throw notFound('Order');
  const { media, url } = await createInvoiceFile(order, req.auth);
  order.activity.push({ type: 'invoice_shared', actorId: req.auth.user._id, note: 'WhatsApp share text requested.' });
  await order.save();
  res.json({ data: { phone: order.customerId.phone, mediaId: media.id, downloadUrl: url, expiresInSeconds: 900, shareText: `Hello ${order.customerId.name}, your invoice ${order.code} is ready. Total ${money(order.totalPaise)}. Balance ${money(order.totalPaise - paidFor(order))}. Download invoice: ${url}` } });
}

module.exports = { invoice, share };
