const {
  localHour,
  reminderMoment,
} = require('../src/services/reminder-jobs.service');

describe('studio-local reminder time', () => {
  test.each([
    ['Asia/Kolkata', '2026-08-21T03:30:00.000Z'],
    ['Australia/Sydney', '2026-08-20T23:00:00.000Z'],
    ['Europe/London', '2026-08-21T08:00:00.000Z'],
    ['America/New_York', '2026-08-21T13:00:00.000Z'],
    ['America/Toronto', '2026-08-21T13:00:00.000Z'],
  ])('%s resolves 09:00 to the correct UTC instant', (timezone, utc) => {
    const localDate = new Date(utc);
    expect(localHour(localDate, timezone)).toBe(9);
    expect(reminderMoment(localDate, 0, timezone).toISOString()).toBe(utc);
  });

  test('does not treat 08:59 local time as the reminder hour', () => {
    expect(localHour(new Date('2026-08-21T03:29:00.000Z'), 'Asia/Kolkata')).toBe(8);
  });
});
