// TM Passkey Manager — MAIN world injection script
// Overrides navigator.credentials.create() and .get() to use our virtual authenticator

(function() {
  'use strict';

  const EXTENSION_ID = '__TM_PASSKEY__';
  let pendingCallbacks = {};
  let callbackId = 0;

  // ─── ArrayBuffer ↔ base64url ───

  function bufToB64url(buf) {
    const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer || buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBuf(b64) {
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(padded);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }

  // ─── Message Bridge ───

  function sendToBackground(data) {
    return new Promise((resolve) => {
      const id = ++callbackId;
      pendingCallbacks[id] = resolve;
      window.postMessage({
        source: EXTENSION_ID,
        direction: 'to-background',
        id,
        data
      }, '*');
      setTimeout(() => {
        if (pendingCallbacks[id]) {
          pendingCallbacks[id]({ error: 'Timeout waiting for background response' });
          delete pendingCallbacks[id];
        }
      }, 30000);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== EXTENSION_ID) return;
    if (event.data.direction !== 'to-page') return;

    const cb = pendingCallbacks[event.data.id];
    if (cb) {
      delete pendingCallbacks[event.data.id];
      cb(event.data.response);
    }
  });

  // ─── Override navigator.credentials.create ───

  const origCreate = navigator.credentials.create.bind(navigator.credentials);
  const origGet = navigator.credentials.get.bind(navigator.credentials);

  navigator.credentials.create = async function(options) {
    if (!options || !options.publicKey) {
      return origCreate(options);
    }

    const pk = options.publicKey;

    // Only intercept for TM-related domains
    const hostname = location.hostname;
    const isTM = hostname.includes('ticketmaster') ||
                 hostname.includes('livenation') ||
                 hostname.includes('queue-it');
    if (!isTM) {
      return origCreate(options);
    }

    console.log('[TM-Passkey] Intercepting credentials.create for', pk.rp?.id || hostname);

    const rpId = pk.rp?.id || hostname;
    const rpName = pk.rp?.name || rpId;
    const userId = pk.user?.id ? bufToB64url(pk.user.id) : '';
    const userName = pk.user?.name || pk.user?.displayName || '';
    const challenge = bufToB64url(pk.challenge);

    const pubKeyCredParams = (pk.pubKeyCredParams || []).map(p => ({
      type: p.type,
      alg: p.alg
    }));

    const resp = await sendToBackground({
      type: 'PASSKEY_CREATE',
      rpId,
      rpName,
      userId,
      userName,
      challenge,
      pubKeyCredParams
    });

    if (resp.error) {
      console.error('[TM-Passkey] Create failed:', resp.error);
      throw new DOMException(resp.error, 'NotAllowedError');
    }

    // Build the PublicKeyCredential response object
    const rawId = b64urlToBuf(resp.rawId);
    const clientDataJSON = b64urlToBuf(resp.clientDataJSON);
    const attestationObject = b64urlToBuf(resp.attestationObject);

    const credential = {
      id: resp.credentialId,
      rawId: rawId,
      type: resp.type,
      authenticatorAttachment: resp.authenticatorAttachment,
      response: {
        clientDataJSON: clientDataJSON,
        attestationObject: attestationObject,
        getTransports: () => ['internal'],
        getPublicKey: () => null,
        getPublicKeyAlgorithm: () => -7,
        getAuthenticatorData: () => null
      },
      getClientExtensionResults: () => ({})
    };

    // Make ArrayBuffer properties behave correctly
    Object.defineProperty(credential.response, 'clientDataJSON', {
      get: () => clientDataJSON,
      enumerable: true
    });
    Object.defineProperty(credential.response, 'attestationObject', {
      get: () => attestationObject,
      enumerable: true
    });

    console.log('[TM-Passkey] Created credential:', resp.credentialId);
    return credential;
  };

  // ─── Override navigator.credentials.get ───

  navigator.credentials.get = async function(options) {
    if (!options || !options.publicKey) {
      return origGet(options);
    }

    const pk = options.publicKey;

    const hostname = location.hostname;
    const isTM = hostname.includes('ticketmaster') ||
                 hostname.includes('livenation') ||
                 hostname.includes('queue-it');
    if (!isTM) {
      return origGet(options);
    }

    console.log('[TM-Passkey] Intercepting credentials.get for', pk.rpId || hostname);

    const rpId = pk.rpId || hostname;
    const challenge = bufToB64url(pk.challenge);
    const allowCredentials = (pk.allowCredentials || []).map(c => ({
      type: c.type,
      id: bufToB64url(c.id)
    }));

    const resp = await sendToBackground({
      type: 'PASSKEY_GET',
      rpId,
      challenge,
      allowCredentials
    });

    if (resp.error) {
      console.error('[TM-Passkey] Get failed:', resp.error);
      // Fall back to native if no credential found — user might want hardware key
      if (resp.error === 'No matching credential found') {
        console.log('[TM-Passkey] No stored credential, falling back to native');
        return origGet(options);
      }
      throw new DOMException(resp.error, 'NotAllowedError');
    }

    const rawId = b64urlToBuf(resp.rawId);
    const clientDataJSON = b64urlToBuf(resp.clientDataJSON);
    const authenticatorData = b64urlToBuf(resp.authenticatorData);
    const signature = b64urlToBuf(resp.signature);
    const userHandle = resp.userHandle ? b64urlToBuf(resp.userHandle) : null;

    const assertion = {
      id: resp.credentialId,
      rawId: rawId,
      type: resp.type,
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: clientDataJSON,
        authenticatorData: authenticatorData,
        signature: signature,
        userHandle: userHandle,
        getTransports: undefined
      },
      getClientExtensionResults: () => ({})
    };

    Object.defineProperty(assertion.response, 'clientDataJSON', {
      get: () => clientDataJSON,
      enumerable: true
    });
    Object.defineProperty(assertion.response, 'authenticatorData', {
      get: () => authenticatorData,
      enumerable: true
    });
    Object.defineProperty(assertion.response, 'signature', {
      get: () => signature,
      enumerable: true
    });
    Object.defineProperty(assertion.response, 'userHandle', {
      get: () => userHandle,
      enumerable: true
    });

    console.log('[TM-Passkey] Authenticated with credential:', resp.credentialId);
    return assertion;
  };

  // ─── Report capability ───
  // Make the platform authenticator appear available
  if (window.PublicKeyCredential) {
    const origIsUVPAA = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async function() {
      console.log('[TM-Passkey] isUserVerifyingPlatformAuthenticatorAvailable → true');
      return true;
    };

    if (PublicKeyCredential.isConditionalMediationAvailable) {
      const origICMA = PublicKeyCredential.isConditionalMediationAvailable;
      PublicKeyCredential.isConditionalMediationAvailable = async function() {
        return true;
      };
    }
  }

  console.log('[TM-Passkey] Virtual authenticator injected');
})();
