const hex = (value: number) => value.toString(16).padStart(2, '0');

/** Creates an ID on HTTPS, localhost, and plain-HTTP LAN deployments. */
type ClientCrypto = Pick<Crypto, 'getRandomValues'> &
  Partial<Pick<Crypto, 'randomUUID'>>;

export const createClientId = (
  clientCrypto: ClientCrypto | undefined = globalThis.crypto
): string => {
  if (typeof clientCrypto?.randomUUID === 'function') {
    return clientCrypto.randomUUID();
  }

  if (typeof clientCrypto?.getRandomValues === 'function') {
    const bytes = clientCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const value = Array.from(bytes, hex).join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
};
