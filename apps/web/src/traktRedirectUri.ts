export interface BrowserLocationLike {
  origin: string;
  hostname: string;
  port: string;
  href?: string;
}

export const TRAKT_RETURN_WINDOW_NAME = 'vynode-trakt-return:';

export const traktRedirectUriForLocation = (
  location: BrowserLocationLike
): string => {
  const localHostnames = new Set(['127.0.0.1', 'localhost', '::1']);
  if (localHostnames.has(location.hostname)) {
    const port = location.port ? `:${location.port}` : '';
    return `http://localhost${port}/settings/sources`;
  }
  return `${location.origin}/settings/sources`;
};

export const traktLocalCallbackTarget = (
  location: BrowserLocationLike,
  windowName: string
): string | undefined => {
  if (
    location.hostname !== 'localhost' ||
    !location.href ||
    !windowName.startsWith(TRAKT_RETURN_WINDOW_NAME)
  )
    return undefined;
  const callback = new URL(location.href);
  if (!callback.searchParams.get('code') || !callback.searchParams.get('state'))
    return undefined;
  const returnOrigin = new URL(
    windowName.slice(TRAKT_RETURN_WINDOW_NAME.length)
  );
  if (
    returnOrigin.protocol !== 'http:' ||
    !['127.0.0.1', '::1'].includes(returnOrigin.hostname) ||
    returnOrigin.port !== location.port
  )
    return undefined;
  return `${returnOrigin.origin}${callback.pathname}${callback.search}`;
};
