import psl from 'psl';

const ALLOWED_DOMAINS =
  process.env.ALLOWED_DOMAINS?.split(',').map((d) => d.trim()).filter(Boolean) ?? [];

export interface GuardResult {
  ok: boolean;
  errorBody?: any;
}

export function checkIframeAndReferer(headers: Record<string, any>): GuardResult {
  const fetchDest = headers['sec-fetch-dest'] || '';
  const isIframe = fetchDest === 'iframe';

  const refererHeader = headers?.referer;
  const refererUrl =
    typeof refererHeader === 'string'
      ? refererHeader
      : Array.isArray(refererHeader)
      ? refererHeader[0]
      : '';

  let refererDomain = '';
  if (refererUrl?.length > 0) {
    const { hostname } = new URL(refererUrl);
    const parsed = psl.parse(hostname);
    refererDomain = (parsed as any)?.domain || '';
  }

  if (!isIframe) {
    return {
      ok: false,
      errorBody: { message: 'Direct Access Denied', statusCode: 403, error: 'Forbidden' },
    };
  }

  if (refererDomain && !ALLOWED_DOMAINS.includes(refererDomain)) {
    return {
      ok: false,
      errorBody: { message: 'Invalid Referer', statusCode: 403, error: 'Forbidden' },
    };
  }

  return { ok: true };
}
