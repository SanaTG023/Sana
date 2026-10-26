function unauthorized() {
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="SanaOS Admin", charset="UTF-8"',
      'Cache-Control': 'no-store'
    }
  });
}

async function credentialsMatch(actual, expected) {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected))
  ]);
  const actualBytes = new Uint8Array(actualHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < actualBytes.length; index++) {
    difference |= actualBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

export default async function protectAdmin(request, context) {
  const username = Netlify.env.get('SANAOS_ADMIN_USERNAME');
  const password = Netlify.env.get('SANAOS_ADMIN_PASSWORD');
  if (!username || !password) {
    return new Response('Admin authentication is not configured.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' }
    });
  }

  const authorization = request.headers.get('authorization') || '';
  const encodedCredentials = authorization.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i)?.[1];
  if (!encodedCredentials) return unauthorized();

  try {
    const bytes = Uint8Array.from(atob(encodedCredentials), character => character.charCodeAt(0));
    const supplied = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const separator = supplied.indexOf(':');
    if (separator < 0) return unauthorized();

    const validUsername = await credentialsMatch(supplied.slice(0, separator), username);
    const validPassword = await credentialsMatch(supplied.slice(separator + 1), password);
    if (!validUsername || !validPassword) return unauthorized();
  } catch {
    return unauthorized();
  }

  return context.next();
}
