/**
 * Key-based masking of sensitive values, applied at READ time so the stored record
 * stays intact and access is decided per request (audit:view-sensitive).
 */
type Kind = 'email' | 'tail' | 'redact';

const KEY_KINDS: Record<string, Kind> = {
  email: 'email',
  phone: 'tail',
  mobile: 'tail',
  cardnumber: 'tail',
  pan: 'tail',
  accountnumber: 'tail',
  iban: 'tail',
  password: 'redact',
  secret: 'redact',
  token: 'redact',
  accesstoken: 'redact',
  refreshtoken: 'redact',
  apikey: 'redact',
  ssn: 'redact',
};

const normalizeKey = (k: string) => k.toLowerCase().replace(/[^a-z]/g, '');

export function maskValue(kind: Kind, value: unknown): unknown {
  if (typeof value !== 'string') return '********';
  switch (kind) {
    case 'email': {
      const at = value.indexOf('@');
      return at > 0 ? `${value[0]}***${value.slice(at)}` : '***';
    }
    case 'tail':
      return value.length <= 4 ? '*'.repeat(value.length) : '*'.repeat(value.length - 4) + value.slice(-4);
    default:
      return '********';
  }
}

export function maskDeep(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(maskDeep);
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([k, v]) => {
        const kind = KEY_KINDS[normalizeKey(k)];
        return [k, kind ? maskValue(kind, v) : maskDeep(v)];
      }),
    );
  }
  return input;
}
