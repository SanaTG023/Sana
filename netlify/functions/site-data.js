const crypto = require('node:crypto');

const repository = 'SanaTG023/Sana';
const branch = 'main';
const filePath = 'data.js';
const maxPayloadBytes = 5 * 1024 * 1024;

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function makeDataFile({ siteConfig, homeConfig, defaultTours }) {
  return `const siteConfig = ${JSON.stringify(siteConfig, null, 2)};\n\n` +
    `const homeConfig = ${JSON.stringify(homeConfig, null, 2)};\n\n` +
    `const defaultTours = ${JSON.stringify(defaultTours, null, 2)};\n\n` +
    `const defaultSiteData = defaultTours[0];\n\n` +
    `if (typeof window !== "undefined") {\n` +
    `  window.siteConfig = siteConfig;\n` +
    `  window.homeConfig = homeConfig;\n` +
    `  window.defaultTours = defaultTours;\n` +
    `  window.defaultSiteData = defaultSiteData;\n` +
    `}\n`;
}

function gitBlobSha(contents) {
  return crypto.createHash('sha1')
    .update(`blob ${Buffer.byteLength(contents, 'utf8')}\0`)
    .update(contents)
    .digest('hex');
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SanaOS-Netlify',
      ...options.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `GitHub returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: 'Method not allowed.' };
  }

  const token = process.env.SANAOS_GITHUB_TOKEN;
  if (!token) return respond(503, { ok: false, message: 'Website publishing is not configured.' });

  const encodedBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64')
    : Buffer.from(event.body || '', 'utf8');
  if (encodedBody.length > maxPayloadBytes) {
    return respond(413, { ok: false, message: 'Website data is too large to publish.' });
  }

  let payload;
  try {
    payload = JSON.parse(encodedBody.toString('utf8'));
  } catch {
    return respond(400, { ok: false, message: 'Invalid JSON payload.' });
  }
  if (!isRecord(payload) || !isRecord(payload.siteConfig) ||
      !isRecord(payload.homeConfig) || !Array.isArray(payload.defaultTours)) {
    return respond(400, { ok: false, message: 'Website data must include siteConfig, homeConfig, and defaultTours.' });
  }
  if (payload.defaultTours.length > 10000) {
    return respond(400, { ok: false, message: 'Too many tour entries.' });
  }

  const contents = makeDataFile(payload);
  if (Buffer.byteLength(contents, 'utf8') > maxPayloadBytes) {
    return respond(413, { ok: false, message: 'Generated website data is too large to publish.' });
  }

  const apiUrl = `https://api.github.com/repos/${repository}/contents/${filePath}`;
  const ref = encodeURIComponent(branch);
  try {
    const existing = await githubRequest(`${apiUrl}?ref=${ref}`, token);
    const blobSha = gitBlobSha(contents);
    if (existing.sha === blobSha) return respond(200, { ok: true, unchanged: true });

    const updated = await githubRequest(apiUrl, token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Sync website content from admin',
        content: Buffer.from(contents, 'utf8').toString('base64'),
        sha: existing.sha,
        branch
      })
    });
    return respond(200, { ok: true, commit: updated.commit.sha });
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      return respond(502, { ok: false, message: 'Website publishing credentials are invalid or lack Contents: Read and write permission.' });
    }
    if (error.status === 409 || error.status === 422) {
      return respond(409, { ok: false, message: 'Website data changed concurrently. Reload the admin page and try again.' });
    }
    if (error.status === 404) {
      return respond(502, { ok: false, message: 'The website data file could not be found in the source repository.' });
    }
    console.error('Website data publish failed:', error);
    return respond(502, { ok: false, message: 'Could not publish website data. Check the deployment logs and try again.' });
  }
};
