// TM Passkey Manager — Background Service Worker
// Virtual FIDO2/WebAuthn authenticator using ECDSA P-256

// ─── Helpers ───

function b64ToBytes(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function bytesToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...arrays) {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ─── CBOR Minimal Encoder ───

function cborEncodeMap(map) {
  const parts = [];
  const keys = Object.keys(map);
  parts.push(new Uint8Array([0xa0 + keys.length]));
  for (const k of keys) {
    parts.push(cborEncodeValue(k));
    parts.push(cborEncodeValue(map[k]));
  }
  return concat(...parts);
}

function cborEncodeValue(v) {
  if (typeof v === 'string') {
    const enc = new TextEncoder().encode(v);
    return concat(cborMajor(3, enc.length), enc);
  }
  if (typeof v === 'number') {
    if (v < 0) {
      const abs = -v - 1;
      return cborMajor(1, abs);
    }
    return cborMajor(0, v);
  }
  if (v instanceof Uint8Array) {
    return concat(cborMajor(2, v.length), v);
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    return cborEncodeMap(v);
  }
  throw new Error('Unsupported CBOR type');
}

function cborMajor(major, val) {
  const m = major << 5;
  if (val < 24) return new Uint8Array([m | val]);
  if (val < 256) return new Uint8Array([m | 24, val]);
  if (val < 65536) return new Uint8Array([m | 25, (val >> 8) & 0xff, val & 0xff]);
  return new Uint8Array([m | 26, (val >> 24) & 0xff, (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff]);
}

// ─── Credential Storage ───

async function getCredentials() {
  const r = await chrome.storage.local.get(['tmPasskeys']);
  return r.tmPasskeys || {};
}

async function saveCredential(rpId, credId, privateKeyJwk, userHandle, userName, rpName) {
  const creds = await getCredentials();
  if (!creds[rpId]) creds[rpId] = [];
  creds[rpId].push({
    credId,
    privateKeyJwk,
    userHandle,
    userName,
    rpName,
    createdAt: Date.now(),
    signCount: 0
  });
  await chrome.storage.local.set({ tmPasskeys: creds });
}

async function findCredential(rpId, allowList) {
  const creds = await getCredentials();
  const rpCreds = creds[rpId] || [];
  if (!rpCreds.length) return null;

  if (allowList && allowList.length) {
    for (const allowed of allowList) {
      const found = rpCreds.find(c => c.credId === allowed);
      if (found) return found;
    }
    return null;
  }
  return rpCreds[0];
}

async function incrementSignCount(rpId, credId) {
  const creds = await getCredentials();
  const rpCreds = creds[rpId] || [];
  const c = rpCreds.find(x => x.credId === credId);
  if (c) {
    c.signCount = (c.signCount || 0) + 1;
    await chrome.storage.local.set({ tmPasskeys: creds });
    return c.signCount;
  }
  return 1;
}

// ─── WebAuthn Crypto ───

async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  return { privateJwk, publicRaw };
}

async function signWithKey(privateJwk, data) {
  const key = await crypto.subtle.importKey(
    'jwk', privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key, data
  ));
  return rawSigToDer(sig);
}

function rawSigToDer(raw) {
  const r = raw.slice(0, 32);
  const s = raw.slice(32, 64);
  const encInt = (bytes) => {
    let arr = Array.from(bytes);
    while (arr.length > 1 && arr[0] === 0) arr.shift();
    if (arr[0] & 0x80) arr.unshift(0);
    return new Uint8Array([0x02, arr.length, ...arr]);
  };
  const rEnc = encInt(r);
  const sEnc = encInt(s);
  const body = concat(rEnc, sEnc);
  return concat(new Uint8Array([0x30, body.length]), body);
}

async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

// ─── Authenticator Data ───

function buildAuthData(rpIdHash, flags, signCount, attestedCredData) {
  const flagByte = new Uint8Array([flags]);
  const sc = new Uint8Array(4);
  new DataView(sc.buffer).setUint32(0, signCount, false);
  const parts = [rpIdHash, flagByte, sc];
  if (attestedCredData) parts.push(attestedCredData);
  return concat(...parts);
}

function buildAttestedCredData(credIdBytes, publicKeyRaw) {
  const aaguid = new Uint8Array(16); // all zeros
  const credIdLen = new Uint8Array(2);
  new DataView(credIdLen.buffer).setUint16(0, credIdBytes.length, false);

  // COSE key for EC2 P-256
  const x = publicKeyRaw.slice(1, 33);
  const y = publicKeyRaw.slice(33, 65);
  const coseKey = cborEncodeCoseKey(x, y);

  return concat(aaguid, credIdLen, credIdBytes, coseKey);
}

function cborEncodeCoseKey(x, y) {
  // CBOR map with integer keys: {1:2, 3:-7, -1:1, -2:x, -3:y}
  // kty=2 (EC2), alg=-7 (ES256), crv=1 (P-256), x, y
  const parts = [];
  parts.push(new Uint8Array([0xa5])); // map of 5

  // 1: 2 (kty: EC2)
  parts.push(cborMajor(0, 1));
  parts.push(cborMajor(0, 2));

  // 3: -7 (alg: ES256)
  parts.push(cborMajor(0, 3));
  parts.push(cborMajor(1, 6)); // -7 = major type 1, value 6

  // -1: 1 (crv: P-256)
  parts.push(cborMajor(1, 0)); // -1 = major type 1, value 0
  parts.push(cborMajor(0, 1));

  // -2: x (byte string)
  parts.push(cborMajor(1, 1)); // -2
  parts.push(concat(cborMajor(2, x.length), x));

  // -3: y (byte string)
  parts.push(cborMajor(1, 2)); // -3
  parts.push(concat(cborMajor(2, y.length), y));

  return concat(...parts);
}

// ─── Create Credential (navigator.credentials.create) ───

async function handleCreate(msg) {
  try {
    const { rpId, rpName, userId, userName, challenge, pubKeyCredParams } = msg;

    const supportsES256 = pubKeyCredParams.some(p => p.alg === -7);
    if (!supportsES256) {
      return { error: 'Only ES256 (alg -7) is supported' };
    }

    const { privateJwk, publicRaw } = await generateKeyPair();

    const credIdBytes = crypto.getRandomValues(new Uint8Array(32));
    const credId = bytesToB64url(credIdBytes);

    const userHandleB64 = userId;
    await saveCredential(rpId, credId, privateJwk, userHandleB64, userName, rpName);

    const rpIdHash = await sha256(new TextEncoder().encode(rpId));
    const attestedCredData = buildAttestedCredData(credIdBytes, publicRaw);

    // flags: UP (0x01) + UV (0x04) + AT (0x40) = 0x45
    const authData = buildAuthData(rpIdHash, 0x45, 0, attestedCredData);

    const challengeBytes = b64ToBytes(challenge);
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({
      type: 'webauthn.create',
      challenge: challenge,
      origin: `https://${rpId}`,
      crossOrigin: false
    }));

    const clientDataHash = await sha256(clientDataJSON);
    const signedData = concat(authData, clientDataHash);
    const signature = await signWithKey(privateJwk, signedData);

    // "none" attestation
    const attObj = cborEncodeMap({
      fmt: 'none',
      attStmt: {},
      authData: authData
    });

    return {
      ok: true,
      credentialId: credId,
      rawId: credId,
      clientDataJSON: bytesToB64url(clientDataJSON),
      attestationObject: bytesToB64url(attObj),
      type: 'public-key',
      authenticatorAttachment: 'platform'
    };
  } catch (e) {
    console.error('[TM-Passkey] create error:', e);
    return { error: e.message };
  }
}

// ─── Get Assertion (navigator.credentials.get) ───

async function handleGet(msg) {
  try {
    const { rpId, challenge, allowCredentials } = msg;

    const allowIds = (allowCredentials || []).map(c => c.id);
    const cred = await findCredential(rpId, allowIds);
    if (!cred) {
      return { error: 'No matching credential found' };
    }

    const signCount = await incrementSignCount(rpId, cred.credId);
    const rpIdHash = await sha256(new TextEncoder().encode(rpId));

    // flags: UP (0x01) + UV (0x04) = 0x05
    const authData = buildAuthData(rpIdHash, 0x05, signCount);

    const clientDataJSON = new TextEncoder().encode(JSON.stringify({
      type: 'webauthn.get',
      challenge: challenge,
      origin: `https://${rpId}`,
      crossOrigin: false
    }));

    const clientDataHash = await sha256(clientDataJSON);
    const signedData = concat(authData, clientDataHash);
    const signature = await signWithKey(cred.privateJwk, signedData);

    return {
      ok: true,
      credentialId: cred.credId,
      rawId: cred.credId,
      clientDataJSON: bytesToB64url(clientDataJSON),
      authenticatorData: bytesToB64url(authData),
      signature: bytesToB64url(signature),
      userHandle: cred.userHandle || '',
      type: 'public-key'
    };
  } catch (e) {
    console.error('[TM-Passkey] get error:', e);
    return { error: e.message };
  }
}

// ─── Message Handler ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PASSKEY_CREATE') {
    handleCreate(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'PASSKEY_GET') {
    handleGet(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'PASSKEY_LIST') {
    getCredentials().then(creds => {
      const list = [];
      for (const [rpId, rpCreds] of Object.entries(creds)) {
        for (const c of rpCreds) {
          list.push({
            rpId,
            credId: c.credId,
            userName: c.userName,
            rpName: c.rpName,
            createdAt: c.createdAt,
            signCount: c.signCount
          });
        }
      }
      sendResponse({ ok: true, credentials: list });
    });
    return true;
  }
  if (msg.type === 'PASSKEY_DELETE') {
    getCredentials().then(async creds => {
      const rpCreds = creds[msg.rpId];
      if (rpCreds) {
        creds[msg.rpId] = rpCreds.filter(c => c.credId !== msg.credId);
        if (!creds[msg.rpId].length) delete creds[msg.rpId];
        await chrome.storage.local.set({ tmPasskeys: creds });
      }
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === 'PASSKEY_DELETE_ALL') {
    chrome.storage.local.set({ tmPasskeys: {} }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

console.log('[TM-Passkey] Background service worker loaded');
