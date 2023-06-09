// Token acquisition flow:
// 1. Load p.js javascript
// 2. Wait for `kpsdk-load` event
// 3. Call `window.KPSDK.configure`
// 4. Wait for `kpsdk-ready` event
// 5. Fetch `gql.twitch.tv/integrity` (p.js hijacks `fetch` to add PoW headers)
// 6. Token should be in `token` field of response, seems to be "Paseto Version 4" format.
//    We want `is_bad_bot` field in the decoded token to be false.

const KPSDKToken = new Promise((resolve, reject) => {
  // Twitch's client-side device ID generation
  function getUniqueID() {
    return "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".replace(/x/g, (function () {
      return (16 * Math.random() | 0).toString(16);
    }
    )).substring(0, 16);
  }

  const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko',
    DEVICE_ID = getUniqueID(),
    SCRIPT_SOURCE = 'https://k.twitchcdn.net/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/p.js';

  function configureKPSDK() {
    const o = [
      {
        "protocol": "https:",
        "method": "POST",
        "domain": "gql.twitch.tv",
        "path": "/integrity"
      }
    ];

    window.KPSDK.configure(o);
  }

  async function fetchIntegrity() {
    const resp = await fetch("https://gql.twitch.tv/integrity", {
      "headers": {
        "client-id": CLIENT_ID,
        "x-device-id": DEVICE_ID,
      },
      "body": null,
      "method": "POST",
      "mode": "cors",
      "credentials": "omit"
    });

    if (resp.status !== 200) {
      throw new Error(`expected http status code 200, got ${resp.status}`);
    }

    return resp.json();
  }

  function appendScript() {
    const l = document.createElement('script');
    l.addEventListener('error', (e) => {
      reject(new Error(`loading script "${SCRIPT_SOURCE}"`));
    });
    l.src = SCRIPT_SOURCE;
    document.body.appendChild(l);
  }

  document.addEventListener('kpsdk-load', configureKPSDK);
  document.addEventListener('kpsdk-ready', () => fetchIntegrity().then(resolve, reject));
  appendScript();
});

// https://github.com/paseto-standard/paseto-spec/blob/master/docs/01-Protocol-Versions/Version4.md
function parseToken(token) {
  const PREFIX = 'v4.public.';
  if (!token.startsWith(PREFIX)) {
    throw new Error(`excepted token to start with "${PREFIX}": ${token}"`);
  }

  let tokenPayloadB64 = token.slice(PREFIX.length).replaceAll('-', '+').replaceAll('_', '/');
  tokenPayloadB64 = tokenPayloadB64.padEnd(tokenPayloadB64.length + tokenPayloadB64.length % 4, '=');

  const tokenPayload = atob(tokenPayloadB64).slice(0, -64);

  return JSON.parse(tokenPayload);
}

async function main() {
  try {
    const token = await KPSDKToken;
    const parsedToken = parseToken(token.token);
    document.getElementById("token").innerText = JSON.stringify(token, null, 2);
    document.getElementById("parsed").innerText = JSON.stringify(parsedToken, null, 2);
  } catch (err) {
    document.getElementById("error").innerText = err;
  }
}

main();