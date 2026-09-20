import {
  add,
  extractImei,
  extractImeis,
  fromMinor,
  luhnCheck,
  marginPercent,
  multiply,
  normalizeImei,
  subtract,
  toMinor,
  validateImei,
  withLuhnCheckDigit,
} from '@phone-erp/shared-types';

describe('Money arithmetic (spec §19, §39)', () => {
  it('never loses a cent to floating point', () => {
    // 0.1 + 0.2 in IEEE 754 is famously not 0.3.
    expect(add('0.10', '0.20')).toBe('0.30');
    expect(multiply('900.00', 1000)).toBe('900000.00');
    expect(multiply('980.00', 500)).toBe('490000.00');
    expect(subtract('490000.00', '450000.00')).toBe('40000.00');
  });

  it('reproduces the specification’s worked example', () => {
    const revenue = multiply('980.00', 500);
    const cost = multiply('900.00', 500);
    const profit = subtract(revenue, cost);
    expect(revenue).toBe('490000.00');
    expect(cost).toBe('450000.00');
    expect(profit).toBe('40000.00');
    expect(marginPercent(revenue, profit)).toBe('8.16');
  });

  it('handles zero revenue without dividing by zero', () => {
    expect(marginPercent('0.00', '0.00')).toBe('0.00');
  });

  it('round-trips through minor units, including negatives', () => {
    for (const value of ['0.00', '1.05', '900.00', '-12.34', '1234567.89']) {
      expect(fromMinor(toMinor(value))).toBe(value);
    }
  });
});

describe('IMEI validation (spec §8, §32)', () => {
  it('strips whatever a scanner adds around the number', () => {
    expect(normalizeImei('  3567-8901 2345_678 ')).toBe('356789012345678');
  });

  it('accepts exactly 15 digits', () => {
    expect(validateImei('356789012345678').valid).toBe(true);
    expect(validateImei('35678901234567').reason).toBe('LENGTH');
    expect(validateImei('3567890123456789').reason).toBe('LENGTH');
    expect(validateImei('35678901234567X').reason).toBe('NON_NUMERIC');
  });

  it('verifies the Luhn check digit when asked', () => {
    const good = withLuhnCheckDigit('99000000000001');
    expect(good).toHaveLength(15);
    expect(luhnCheck(good)).toBe(true);
    expect(validateImei(good, { enforceChecksum: true }).valid).toBe(true);

    const bad = good.slice(0, 14) + String((Number(good[14]) + 1) % 10);
    expect(validateImei(bad, { enforceChecksum: true }).reason).toBe('CHECKSUM');
    // Off by default, because plenty of real stock carries mistyped IMEIs.
    expect(validateImei(bad).valid).toBe(true);
  });
});

describe('Reading an IMEI out of a real barcode (spec §32)', () => {
  const A = withLuhnCheckDigit('35678901234567');
  const B = withLuhnCheckDigit('35678901234575');

  /**
   * A scanner rarely hands over a bare 15-digit number. Requiring that — which
   * the scanner used to do — silently dropped most real labels: the digits
   * arrived and nothing happened.
   */
  it.each([
    ['a plain Code 128 symbol', () => A, () => A],
    ['an AIM identifier prefix', () => `]C1${A}`, () => A],
    ['a labelled field', () => `IMEI:${A}`, () => A],
    ['separators the printer added', () => `${A.slice(0, 8)} ${A.slice(8)}`, () => A],
    ['a 16-digit IMEISV', () => '3567890123456712', () => A],
    ['a model line beside it', () => `MODEL:A3102 IMEI:${A}`, () => A],
    ['a GS1 payload', () => `0109501101020917171905${A}`, () => A],
    ['a multi-line label', () => `IMEI: ${A}\nSN: F2LX39ABCDEF`, () => A],
  ])('reads %s', (_label, payload, expected) => {
    expect(extractImei(payload())).toBe(expected());
  });

  it('returns both numbers from a dual-SIM label, primary first', () => {
    expect(extractImeis(`IMEI1:${A} IMEI2:${B} SN:F2LX39ABCDEF`)).toEqual([A, B]);
    expect(extractImeis(`${A},${B}`)).toEqual([A, B]);
  });

  it('picks the real IMEI out of digits that merely satisfy the check', () => {
    // A GS1 string yields several Luhn-valid windows; only one starts with a
    // reporting body that is actually allocated.
    const candidates = extractImeis(`0109501101020917171905${A}`);
    expect(candidates[0]).toBe(A);
  });

  it('completes a label that omits the check digit', () => {
    // Some manufacturers encode only the 14-digit TAC and serial.
    expect(extractImei('35678901234567')).toBe(A);
    // But only when it starts like an IMEI — otherwise any 14-digit figure on
    // the box could be "completed" into a plausible one.
    expect(extractImei('12345678901234')).toBeNull();
  });

  it('does not mistake the other barcodes on a phone box for the IMEI', () => {
    expect(extractImei('0195949045678')).toBeNull();   // EAN-13 product code
    expect(extractImei('012345678905')).toBeNull();    // UPC
    expect(extractImei('F2LX39ABCDEF')).toBeNull();    // serial number
  });

  it('refuses digits that are not an IMEI at all', () => {
    expect(extractImei('99999999999999999999')).toBeNull();
    expect(extractImei('SN:F2LX39ABCDEF')).toBeNull();
    expect(extractImei('')).toBeNull();
  });

  it('still accepts a lone mistyped IMEI, because real stock carries them', () => {
    expect(extractImei('356789012345999')).toBe('356789012345999');
    // …but not when it could be any slice of a longer string.
    expect(extractImei('order 356789012345999 qty 12')).toBeNull();
  });

  it('can be told to insist on the check digit', () => {
    expect(extractImei('356789012345999', { requireChecksum: true })).toBeNull();
    expect(extractImei(A, { requireChecksum: true })).toBe(A);
  });
});
