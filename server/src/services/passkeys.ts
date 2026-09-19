/**
 * Passkeys, as a second factor: a password gets you a challenge, a passkey finishes it.
 *
 * WebAuthn verification is left to @simplewebauthn/server — signature checking, challenge binding, origin and RP-ID
 * matching and the clone-detecting counter are exactly the places where a home-made version fails quietly.
 *
 * A passkey is bound to the origin it was made on, so one registered on `http://localhost:3579` will not work when
 * the same server is reached over the LAN. That needs https and a matching WEBAUTHN_ORIGIN / WEBAUTHN_RP_ID.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { env } from "@/env";
import { childLogger } from "@/lib/logger";
import { CredentialStore } from "@/stores/user-store";
import type { Credential, User } from "@/db/schema";

const log = childLogger("passkeys");

const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
/** A copy in its own ArrayBuffer: Buffer views share a pooled buffer, which the verifier's types reject. */
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(value, "base64url");
  const bytes = new Uint8Array(new ArrayBuffer(decoded.byteLength));
  bytes.set(decoded);
  return bytes;
}

const transportsOf = (credential: Credential): AuthenticatorTransportFuture[] =>
  credential.transports ? (JSON.parse(credential.transports) as AuthenticatorTransportFuture[]) : [];

type AuthenticatorTransportFuture = NonNullable<Parameters<typeof verifyAuthenticationResponse>[0]["credential"]["transports"]>[number];

/** What the browser needs to create a passkey for this account, and the challenge to remember. */
export async function registrationOptions(user: User): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await CredentialStore.listByUser(user.id);
  return generateRegistrationOptions({
    rpName: env.WEBAUTHN_RP_NAME,
    rpID: env.WEBAUTHN_RP_ID,
    userName: user.username,
    userDisplayName: user.displayName ?? user.username,
    // Stable across enrolments, so the authenticator knows it is the same account
    userID: new TextEncoder().encode(String(user.id)),
    attestationType: "none",
    // Nothing is offered twice: the browser tells the person they already have one here
    excludeCredentials: existing.map((credential) => ({ id: credential.id, transports: transportsOf(credential) })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
}

/** Checks what the browser sent back and stores the passkey. Returns null when verification fails. */
export async function saveRegistration(
  user: User,
  name: string,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<Credential | null> {
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: env.WEBAUTHN_ORIGIN,
      expectedRPID: env.WEBAUTHN_RP_ID,
      requireUserVerification: false,
    });
  } catch (err) {
    log.warn({ err, userId: user.id }, "Passkey registration rejected");
    return null;
  }
  if (!verification.verified || !verification.registrationInfo) return null;

  const { credential } = verification.registrationInfo;
  return CredentialStore.insert({
    id: credential.id,
    userId: user.id,
    name,
    publicKey: toBase64Url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ? JSON.stringify(credential.transports) : null,
  });
}

/** What the browser needs to prove a passkey mid-sign-in; only this account's keys are offered. */
export async function authenticationOptions(user: User): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const credentials = await CredentialStore.listByUser(user.id);
  return generateAuthenticationOptions({
    rpID: env.WEBAUTHN_RP_ID,
    allowCredentials: credentials.map((credential) => ({ id: credential.id, transports: transportsOf(credential) })),
    userVerification: "preferred",
  });
}

/** Verifies an assertion against the stored key, and moves the counter on. False for anything that doesn't check out. */
export async function verifyAssertion(user: User, response: AuthenticationResponseJSON, expectedChallenge: string): Promise<boolean> {
  const credential = await CredentialStore.findById(response.id);
  if (!credential || credential.userId !== user.id) {
    log.warn({ userId: user.id, credentialId: response.id }, "Passkey not on this account");
    return false;
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: env.WEBAUTHN_ORIGIN,
      expectedRPID: env.WEBAUTHN_RP_ID,
      requireUserVerification: false,
      credential: {
        id: credential.id,
        publicKey: fromBase64Url(credential.publicKey),
        counter: credential.counter,
        transports: transportsOf(credential),
      },
    });
  } catch (err) {
    log.warn({ err, userId: user.id }, "Passkey assertion rejected");
    return false;
  }
  if (!verification.verified) return false;

  // A counter that hasn't moved on is how a cloned authenticator shows up, and the conditional update is also what
  // decides between two assertions racing on separate challenges: only the one that advanced it signs in. Keys that
  // always report zero have no counter to go by, and are let through as before.
  const newCounter = verification.authenticationInfo.newCounter;
  const advanced = await CredentialStore.touch(credential.id, newCounter);
  if (newCounter !== 0 && !advanced) {
    log.warn({ userId: user.id, credentialId: credential.id }, "Passkey counter did not advance");
    return false;
  }
  return true;
}
