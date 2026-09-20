import { classifyBarcode } from '@phone-erp/shared-types';

describe('classifyBarcode', () => {
  it('tags a clean or embedded IMEI as IMEI', () => {
    expect(classifyBarcode('990000000000010')).toEqual({ kind: 'IMEI', imei: '990000000000010' });
    expect(classifyBarcode('IMEI: 35678901234567-SV')).toEqual({ kind: 'IMEI', imei: '356789012345672' });
    expect(classifyBarcode('35305510-14080-9')).toEqual({ kind: 'IMEI', imei: '353055101408091' });
  });

  it('tags a serial/part code as SERIAL even when it embeds digits', () => {
    expect(classifyBarcode('S/N:2UKBB25506101197')).toEqual({ kind: 'SERIAL', serial: '2UKBB25506101197' });
    expect(classifyBarcode('2UKBB25506101197')).toEqual({ kind: 'SERIAL', serial: '2UKBB25506101197' });
    expect(classifyBarcode('sn#FWXO-778293-01')).toEqual({ kind: 'SERIAL', serial: 'FWXO77829301' });
    // A bare 14-digit run is not an IMEI (15) nor an EAN (12/13): put it as serial.
    expect(classifyBarcode('08801234567893')).toEqual({ kind: 'SERIAL', serial: '08801234567893' });
  });

  it('tags digits-only 13 and 12 runs as EAN-13 and UPC-A', () => {
    expect(classifyBarcode('0880123456789')).toEqual({ kind: 'EAN', digits: '0880123456789', eanType: 'EAN' });
    expect(classifyBarcode('123456789012')).toEqual({ kind: 'EAN', digits: '123456789012', eanType: 'UPC' });
  });

  it('returns OTHER for empty or meaningless payloads', () => {
    expect(classifyBarcode('').kind).toBe('OTHER');
    expect(classifyBarcode('hello').kind).toBe('OTHER');
  });
});