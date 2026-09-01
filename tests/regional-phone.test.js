const { normalizeRegionalPhone } = require('../src/utils/regional-phone');

describe('regional phone normalization', () => {
  test.each([
    ['IN', '9876543210', '+919876543210'],
    ['US', '4155552671', '+14155552671'],
    ['CA', '4165552671', '+14165552671'],
    ['GB', '02079460018', '+442079460018'],
    ['AU', '0412345678', '+61412345678'],
  ])('%s local numbers are stored as E.164', (country, input, expected) => {
    expect(normalizeRegionalPhone(input, country)).toBe(expected);
  });

  test('rejects a country code that differs from the studio region', () => {
    expect(() => normalizeRegionalPhone('+919876543210', 'AU')).toThrow(
      expect.objectContaining({ code: 'PHONE_COUNTRY_MISMATCH' }),
    );
  });
});
