/**
 * The browser half of WebAuthn, written out rather than pulled in: @simplewebauthn/browser is a thin wrapper over
 * `navigator.credentials`, and the server does the verifying.
 *
 * Passkeys only exist on a secure context, so this works on localhost and over https, and not on a plain-http LAN
 * address. `supportsPasskeys()` is what the account page asks before offering to enrol one.
 */

const fromBase64Url = (value: string): ArrayBuffer => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

const toBase64Url = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Whether this browser can do passkeys at all (an insecure origin can't). */
export const supportsPasskeys = (): boolean =>
  typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function";

interface CredentialDescriptorJSON {
  id: string;
  type?: string;
  transports?: string[];
}

interface CreationOptionsJSON {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: string; alg: number }[];
  timeout?: number;
  attestation?: string;
  excludeCredentials?: CredentialDescriptorJSON[];
  authenticatorSelection?: Record<string, unknown>;
}

interface RequestOptionsJSON {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: string;
  allowCredentials?: CredentialDescriptorJSON[];
}

const descriptors = (list: CredentialDescriptorJSON[] | undefined): PublicKeyCredentialDescriptor[] =>
  (list ?? []).map((item) => ({
    id: fromBase64Url(item.id),
    type: "public-key",
    ...(item.transports ? { transports: item.transports as AuthenticatorTransport[] } : {}),
  }));

/** Creates a passkey for this account and returns what the server needs to verify it. */
export async function startRegistration(options: CreationOptionsJSON): Promise<Record<string, unknown>> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: fromBase64Url(options.challenge),
      user: { ...options.user, id: fromBase64Url(options.user.id) },
      pubKeyCredParams: options.pubKeyCredParams as PublicKeyCredentialParameters[],
      excludeCredentials: descriptors(options.excludeCredentials),
      attestation: options.attestation as AttestationConveyancePreference | undefined,
      authenticatorSelection: options.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("no passkey was created");

  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
  };
}

/** Signs the server's challenge with a passkey the account already has. */
export async function startAssertion(options: RequestOptionsJSON): Promise<Record<string, unknown>> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      ...options,
      challenge: fromBase64Url(options.challenge),
      allowCredentials: descriptors(options.allowCredentials),
      userVerification: options.userVerification as UserVerificationRequirement | undefined,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("no passkey was used");

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
    },
  };
}
