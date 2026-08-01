import { describe, expect, it } from 'vitest';

import {
  TRAKT_RETURN_WINDOW_NAME,
  traktLocalCallbackTarget,
  traktRedirectUriForLocation,
} from './traktRedirectUri';

describe('traktRedirectUriForLocation', () => {
  it('uses one stable localhost callback across local loopback aliases', () => {
    expect(
      traktRedirectUriForLocation({
        origin: 'http://127.0.0.1:5174',
        hostname: '127.0.0.1',
        port: '5174',
      })
    ).toBe('http://localhost:5174/settings/sources');
    expect(
      traktRedirectUriForLocation({
        origin: 'http://localhost:5174',
        hostname: 'localhost',
        port: '5174',
      })
    ).toBe('http://localhost:5174/settings/sources');
  });

  it('preserves the deployed origin for production callbacks', () => {
    expect(
      traktRedirectUriForLocation({
        origin: 'https://vynode.example',
        hostname: 'vynode.example',
        port: '',
      })
    ).toBe('https://vynode.example/settings/sources');
  });

  it('bridges a localhost callback back to the authenticated loopback alias', () => {
    expect(
      traktLocalCallbackTarget(
        {
          origin: 'http://localhost:5174',
          hostname: 'localhost',
          port: '5174',
          href: 'http://localhost:5174/settings/sources?code=one&state=two',
        },
        `${TRAKT_RETURN_WINDOW_NAME}http://127.0.0.1:5174`
      )
    ).toBe(
      'http://127.0.0.1:5174/settings/sources?code=one&state=two'
    );
  });

  it('rejects callback bridges to non-loopback or mismatched-port origins', () => {
    const callback = {
      origin: 'http://localhost:5174',
      hostname: 'localhost',
      port: '5174',
      href: 'http://localhost:5174/settings/sources?code=one&state=two',
    };
    expect(
      traktLocalCallbackTarget(
        callback,
        `${TRAKT_RETURN_WINDOW_NAME}https://attacker.example`
      )
    ).toBeUndefined();
    expect(
      traktLocalCallbackTarget(
        callback,
        `${TRAKT_RETURN_WINDOW_NAME}http://127.0.0.1:9999`
      )
    ).toBeUndefined();
  });
});
