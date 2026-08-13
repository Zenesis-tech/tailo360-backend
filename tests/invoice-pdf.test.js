const fs = require('fs');
const path = require('path');
const { pdfFor } = require('../src/controllers/invoice.controller');

const pageCount = (buffer) => (
  buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []
).length;

test('renders a branded studio invoice with logo assets', async () => {
  const logo = fs.readFileSync(path.resolve(__dirname, '../../assets/svg/logo.png'));
  const buffer = await pdfFor(
    {
      code: 'TL-1042',
      orderDate: new Date('2026-08-14T00:00:00.000Z'),
      deliveryDate: new Date('2026-08-21T00:00:00.000Z'),
      customerId: {
        name: 'Aarav Sharma',
        phone: '+91 98765 43210',
        address: 'MG Road, Bengaluru',
      },
      lines: [
        { name: 'Wedding sherwani', quantity: 1, unitPricePaise: 1250000, lineTotalPaise: 1250000 },
        { name: 'Tailored trousers', quantity: 2, unitPricePaise: 275000, lineTotalPaise: 550000 },
      ],
      payments: [{ direction: 'collection', amountPaise: 500000 }],
      totalPaise: 1800000,
      notes: 'Final fitting requested before delivery.',
    },
    {
      name: 'Ramesh Bespoke Studio',
      address: '12 MG Road, Bengaluru',
      settings: { invoice: { footer: 'Crafted especially for you.' } },
    },
    {
      studioLogo: logo,
      tailoLogo: logo,
      owner: { phone: '+91 98765 43210', email: 'studio@example.com' },
    },
  );

  expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  expect(buffer.length).toBeGreaterThan(5000);
  expect(pageCount(buffer)).toBe(1);
});

test('renders when no studio logo is configured', async () => {
  const buffer = await pdfFor(
    {
      code: 'TL-1',
      orderDate: new Date('2026-08-14T00:00:00.000Z'),
      deliveryDate: new Date('2026-08-20T00:00:00.000Z'),
      customerId: { name: 'Customer', phone: '', address: '' },
      lines: [{ name: 'Kurta', quantity: 1, unitPricePaise: 100000, lineTotalPaise: 100000 }],
      payments: [],
      totalPaise: 100000,
      notes: '',
    },
    { name: 'My Studio', address: '', settings: {} },
  );

  expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  expect(pageCount(buffer)).toBe(1);
});
