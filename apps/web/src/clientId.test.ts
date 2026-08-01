import { describe, expect, it } from 'vitest';
import { createClientId } from './clientId';

describe('createClientId', () => {
  it('uses the UUID API when the browser exposes it', () => {
    const expected = '11111111-2222-4333-8444-555555555555';
    const crypto = {
      randomUUID: () => expected,
      getRandomValues: <T extends ArrayBufferView | null>(value: T) => value,
    } as unknown as Crypto;

    expect(createClientId(crypto)).toBe(expected);
  });

  it('creates a UUID when randomUUID is unavailable on plain HTTP', () => {
    const crypto = {
      getRandomValues: <T extends ArrayBufferView | null>(value: T) => {
        if (value instanceof Uint8Array) {
          value.forEach((_, index) => (value[index] = index));
        }
        return value;
      },
    } as Pick<Crypto, 'getRandomValues'>;

    expect(createClientId(crypto)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
