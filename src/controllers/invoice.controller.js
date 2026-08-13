const fs = require('fs');
const path = require('path');
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
const shortDate = (value) => new Date(value).toLocaleDateString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric',
});

function safeImage(doc, source, x, y, options) {
  if (!source) return false;
  try {
    doc.image(source, x, y, options);
    return true;
  } catch (_) {
    return false;
  }
}

function pdfFor(order, studio, { studioLogo, tailoLogo, owner } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 46, size: 'A4', info: { Title: `Invoice ${order.code}` } });
    const parts = [];
    doc.on('data', (part) => parts.push(part));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.on('error', reject);

    const left = 46;
    const right = 549;
    const width = right - left;
    const purple = '#5536E8';
    const deepPurple = '#35218F';
    const orange = '#FF7300';
    const ink = '#171A2E';
    const muted = '#6E738A';
    const border = '#E6E7EF';
    const soft = '#F6F5FC';

    // A restrained brand rail gives the invoice identity without overpowering
    // the studio whose work the customer is paying for.
    doc.rect(0, 0, 9, 842).fill(purple);
    doc.rect(9, 0, 586, 6).fill(orange);

    const logoDrawn = safeImage(doc, studioLogo, left, 40, { fit: [58, 58], align: 'center', valign: 'center' });
    if (!logoDrawn) {
      doc.roundedRect(left, 40, 58, 58, 12).fill('#EEEAFE');
      doc.fillColor(purple).font('Helvetica-Bold').fontSize(24)
        .text((studio.name || 'S').trim().charAt(0).toUpperCase(), left, 56, { width: 58, align: 'center' });
    }

    const studioX = left + 72;
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(20)
      .text(studio.name || 'Your Studio', studioX, 42, { width: 270, ellipsis: true });
    if (studio.address) {
      doc.fillColor(muted).font('Helvetica').fontSize(8.5)
        .text(studio.address, studioX, 69, { width: 270, height: 25, ellipsis: true });
    }
    const contact = [owner?.phone, owner?.email].filter(Boolean).join('  |  ');
    if (contact) doc.fillColor(muted).fontSize(8).text(contact, studioX, 92, { width: 270 });

    doc.fillColor(purple).font('Helvetica-Bold').fontSize(9)
      .text('TAX INVOICE', 394, 42, { width: 155, align: 'right', characterSpacing: 1.2 });
    doc.fillColor(ink).fontSize(18)
      .text(order.code, 374, 60, { width: 175, align: 'right' });
    doc.fillColor(muted).font('Helvetica').fontSize(8.5)
      .text(`Issued ${shortDate(new Date())}`, 394, 87, { width: 155, align: 'right' });

    doc.moveTo(left, 120).lineTo(right, 120).lineWidth(1).strokeColor(border).stroke();

    doc.roundedRect(left, 141, width, 84, 10).fill(soft);
    doc.fillColor(purple).font('Helvetica-Bold').fontSize(8)
      .text('BILL TO', left + 16, 156, { characterSpacing: 1 });
    doc.fillColor(ink).fontSize(13).text(order.customerId.name, left + 16, 174, { width: 245 });
    const customerLines = [order.customerId.phone, order.customerId.address].filter(Boolean).join('\n');
    doc.fillColor(muted).font('Helvetica').fontSize(8.5)
      .text(customerLines, left + 16, 194, { width: 260, height: 27, ellipsis: true });

    doc.fillColor(purple).font('Helvetica-Bold').fontSize(8)
      .text('ORDER DETAILS', 355, 156, { width: 178, align: 'right', characterSpacing: 1 });
    doc.fillColor(muted).font('Helvetica').fontSize(8.5)
      .text(`Order date   ${shortDate(order.orderDate)}`, 355, 177, { width: 178, align: 'right' })
      .text(`Delivery      ${shortDate(order.deliveryDate)}`, 355, 194, { width: 178, align: 'right' });

    let y = 251;
    doc.roundedRect(left, y, width, 28, 6).fill(deepPurple);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8)
      .text('DESCRIPTION', left + 12, y + 10, { characterSpacing: .7 })
      .text('QTY', 365, y + 10, { width: 42, align: 'center' })
      .text('RATE', 409, y + 10, { width: 62, align: 'right' })
      .text('AMOUNT', 473, y + 10, { width: 64, align: 'right' });
    y += 38;

    order.lines.forEach((line, index) => {
      if (y > 650) {
        doc.addPage();
        doc.rect(0, 0, 9, 842).fill(purple);
        y = 48;
      }
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(10)
        .text(line.name, left + 12, y, { width: 295 });
      doc.fillColor(muted).font('Helvetica').fontSize(8)
        .text(`Custom tailoring service${line.quantity > 1 ? 's' : ''}`, left + 12, y + 16, { width: 295 });
      doc.fillColor(ink).fontSize(9)
        .text(String(line.quantity), 365, y + 7, { width: 42, align: 'center' })
        .text(money(line.unitPricePaise), 409, y + 7, { width: 62, align: 'right' });
      doc.font('Helvetica-Bold').text(money(line.lineTotalPaise), 473, y + 7, { width: 64, align: 'right' });
      y += 39;
      if (index < order.lines.length - 1) {
        doc.moveTo(left + 12, y).lineTo(right - 12, y).lineWidth(.7).strokeColor(border).stroke();
        y += 10;
      }
    });

    y += 14;
    const paid = paidFor(order);
    const balance = Math.max(0, order.totalPaise - paid);
    const summaryX = 330;
    doc.moveTo(summaryX, y).lineTo(right, y).lineWidth(1).strokeColor(border).stroke();
    y += 14;
    doc.fillColor(muted).font('Helvetica').fontSize(9).text('Subtotal', summaryX, y)
      .fillColor(ink).font('Helvetica-Bold').text(money(order.totalPaise), 430, y, { width: 119, align: 'right' });
    y += 22;
    doc.fillColor(muted).font('Helvetica').text('Amount paid', summaryX, y)
      .fillColor('#16865A').font('Helvetica-Bold').text(`- ${money(paid)}`, 430, y, { width: 119, align: 'right' });
    y += 28;
    doc.roundedRect(summaryX - 12, y - 9, 231, 46, 8).fill('#EEEAFE');
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text('BALANCE DUE', summaryX, y + 7)
      .fillColor(purple).fontSize(15).text(money(balance), 430, y + 3, { width: 107, align: 'right' });

    const noteY = Math.min(y + 70, 686);
    if (order.notes) {
      doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('ORDER NOTE', left, noteY);
      doc.fillColor(ink).font('Helvetica').fontSize(8.5)
        .text(order.notes, left, noteY + 15, { width: 260, height: 42, ellipsis: true });
    }
    const configuredFooter = studio.settings?.invoice?.footer?.trim();
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(10)
      .text(configuredFooter || 'Thank you for choosing us.', left, 729, { width, align: 'center' });
    doc.fillColor(muted).font('Helvetica').fontSize(7.5)
      .text('This is a computer-generated invoice.', left, 746, { width, align: 'center' });

    doc.moveTo(left, 779).lineTo(right, 779).lineWidth(.7).strokeColor(border).stroke();
    const tailoDrawn = safeImage(doc, tailoLogo, left, 791, { fit: [28, 24], align: 'center', valign: 'center' });
    const brandX = tailoDrawn ? left + 35 : left;
    doc.fillColor(muted).font('Helvetica').fontSize(7.5).text('Powered by', brandX, 797);
    doc.fillColor(purple).font('Helvetica-Bold').fontSize(9).text('Tailo', brandX + 40, 795);
    doc.fillColor(orange).text('360', brandX + 61, 795);
    doc.fillColor(muted).font('Helvetica').fontSize(7.5)
      .text('Professional studio management', 390, 797, { width: 159, align: 'right' });
    doc.end();
  });
}

async function invoiceAssets(studio) {
  let studioLogo;
  if (studio.logoMediaId) {
    try {
      const media = await Media.findOne({ _id: studio.logoMediaId, studioId: studio._id, status: 'ready' });
      if (media) studioLogo = await r2.getObject(media.objectKey);
    } catch (_) { /* An invoice must still work if a logo is unavailable. */ }
  }
  const logoPath = path.resolve(__dirname, '../../../assets/svg/logo.png');
  const tailoLogo = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : undefined;
  return { studioLogo, tailoLogo };
}

async function createInvoiceFile(order, auth, { includeUrl = true } = {}) {
  const assets = await invoiceAssets(auth.studio);
  const buffer = await pdfFor(order, auth.studio, { ...assets, owner: auth.user });
  const key = `${auth.studio._id}/invoices/${order.code}-${nanoid(10)}.pdf`;
  await r2.putObject({ key, body: buffer, contentType: 'application/pdf' });
  const media = await Media.create({ studioId: auth.studio._id, ownerUserId: auth.user._id, objectKey: key, originalName: `${order.code}.pdf`, contentType: 'application/pdf', sizeBytes: buffer.length, purpose: 'invoice_pdf', status: 'ready' });
  return { media, buffer, url: includeUrl ? await r2.createReadUrl(key) : undefined };
}

async function invoice(req, res) {
  const order = await Order.findOne({ _id: req.params.id, studioId: req.auth.studio._id, deletedAt: null })
    .populate('customerId', 'name phone address');
  if (!order) throw notFound('Order');
  const { media, url } = await createInvoiceFile(order, req.auth);
  order.activity.push({ type: 'invoice_generated', actorId: req.auth.user._id, note: `Invoice PDF generated: ${media.id}` });
  await order.save();
  res.json({ data: { mediaId: media.id, downloadUrl: url, expiresInSeconds: 900 } });
}

async function share(req, res) {
  const order = await Order.findOne({ _id: req.params.id, studioId: req.auth.studio._id, deletedAt: null })
    .populate('customerId', 'name phone address');
  if (!order) throw notFound('Order');
  const { media, buffer } = await createInvoiceFile(order, req.auth, { includeUrl: false });
  order.activity.push({ type: 'invoice_shared', actorId: req.auth.user._id, note: 'WhatsApp share text requested.' });
  await order.save();
  res.json({ data: { phone: order.customerId.phone, mediaId: media.id, fileName: `${order.code}.pdf`, contentType: 'application/pdf', pdfBase64: buffer.toString('base64'), shareText: `Hello ${order.customerId.name}, your invoice ${order.code} is attached. Total ${money(order.totalPaise)}. Balance ${money(order.totalPaise - paidFor(order))}.` } });
}

module.exports = { invoice, share, pdfFor };
