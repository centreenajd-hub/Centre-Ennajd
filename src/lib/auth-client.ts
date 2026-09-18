// Thin wrapper around Supabase Authentication for the Centre Ennajd staff
// login. No public sign-up — accounts are created manually in the Supabase
// console (Authentication → Users → Add user).

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

// Map Supabase auth error codes to the Firebase-compatible codes
// that LoginPage.tsx's i18n table already understands.
function mapSupabaseError(
  err: { message?: string; code?: string },
): Error & { code: string } {
  const msg = (err.message ?? "").toLowerCase();
  const code = err.code ?? "";

  // Supabase returns "Invalid login credentials" for wrong email/password
  if (
    msg.includes("invalid") ||
    msg.includes("invalid login") ||
    code === "invalid_credentials"
  ) {
    return Object.assign(new Error(err.message), {
      code: "auth/invalid-credential",
    });
  }
  if (msg.includes("email")) {
    return Object.assign(new Error(err.message), { code: "auth/invalid-email" });
  }
  if (msg.includes("too many") || msg.includes("rate") || msg.includes("429")) {
    return Object.assign(new Error(err.message), { code: "auth/too-many-requests" });
  }
  if (msg.includes("disabled") || msg.includes("banned") || code === "user_banned") {
    return Object.assign(new Error(err.message), { code: "auth/user-disabled" });
  }

  return Object.assign(new Error(err.message), { code: "auth/unknown" });
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw mapSupabaseError(error);
}

export async function signOutUser(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function useAuthUser(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

// WebAuthn / Biometric Authentication

export interface WebAuthnRegisterOptions {
  challenge: string;
  userId: string;
  userName: string;
  userEmail: string;
}

export interface WebAuthnLoginOptions {
  challenge: string;
  allowCredentials: Array<{ id: string; type: "public-key" }>;
  userVerification: "required" | "preferred" | "discouraged";
}

// Check if WebAuthn is supported in the browser
export function isWebAuthnSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.PublicKeyCredential;
}

// Generate a random challenge for WebAuthn
function generateChallenge(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Convert ArrayBuffer to base64 string
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

// Convert base64 string to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Check if user has registered WebAuthn credentials
export async function hasRegisteredCredentials(email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("webauthn_credentials")
    .select("id", { count: "exact", head: true })
    .eq("userEmail", email);

  if (error) {
    console.error("Error checking WebAuthn credentials:", error);
    return false;
  }

  return (data?.length ?? 0) > 0;
}

// Get registration options from backend
export async function getRegisterOptions(email: string): Promise<WebAuthnRegisterOptions> {
  const response = await fetch("/api/webauthn/register-options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error("Failed to get registration options");
  }

  return response.json();
}

// Register a new biometric credential
export async function registerCredential(
  options: WebAuthnRegisterOptions,
  email: string,
): Promise<boolean> {
  try {
    const publicKey: PublicKeyCredentialCreationOptions = {
      challenge: base64ToArrayBuffer(options.challenge),
      rp: { name: "Centre Ennajd", id: "localhost" },
      user: {
        id: new TextEncoder().encode(options.userId),
        name: options.userName,
        displayName: options.userName,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256
      timeout: 60000,
      attestation: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
      },
    };

    const credential = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential;

    if (!credential) {
      throw new Error("Credential creation failed");
    }

    // Send the credential to backend for storage
        const response = await fetch("/api/webauthn/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            credential: {
              id: credential.id,
              rawId: arrayBufferToBase64(credential.rawId as ArrayBuffer),
              response: {
                attestationObject: arrayBufferToBase64(
                  (credential.response as AuthenticatorAttestationResponse).attestationObject,
                ),
                clientDataJSON: arrayBufferToBase64(
                  (credential.response as AuthenticatorAttestationResponse).clientDataJSON,
                ),
              },
              type: credential.type,
            },
          }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Registration failed");
    }

    return true;
  } catch (error) {
    console.error("Biometric registration failed:", error);
    throw error;
  }
}

// Get login options from backend
export async function getLoginOptions(email: string): Promise<WebAuthnLoginOptions> {
  const response = await fetch("/api/webauthn/login-options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error("Failed to get login options");
  }

  return response.json();
}

// Authenticate with biometric
export async function authenticateWithWebAuthn(email: string): Promise<boolean> {
  try {
    // Get login options from backend
    const options: WebAuthnLoginOptions = await getLoginOptions(email);

    // Configure WebAuthn
    const publicKey: PublicKeyCredentialRequestOptions = {
      challenge: base64ToArrayBuffer(options.challenge),
      allowCredentials: options.allowCredentials.map((cred) => ({
        id: base64ToArrayBuffer(cred.id),
        type: "public-key",
      })),
      userVerification: options.userVerification,
      timeout: 60000,
    };

    const assertion = (await navigator.credentials.get({
      publicKey,
    })) as PublicKeyCredential;

    if (!assertion) {
      throw new Error("Authentication failed");
    }

    // Send the authentication assertion to backend for verification
        const authResponse = assertion.response as AuthenticatorAssertionResponse;
        const response = await fetch("/api/webauthn/authenticate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            credential: {
              id: assertion.id,
              rawId: arrayBufferToBase64(assertion.rawId as ArrayBuffer),
              response: {
                authenticatorData: arrayBufferToBase64(authResponse.authenticatorData),
                clientDataJSON: arrayBufferToBase64(authResponse.clientDataJSON),
                signature: arrayBufferToBase64(authResponse.signature),
                userHandle: authResponse.userHandle
                  ? arrayBufferToBase64(authResponse.userHandle as ArrayBuffer)
                  : null,
              },
              type: assertion.type,
            },
          }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Authentication failed");
    }

    const data = await response.json();

    // If backend returns Supabase session info, set it
        if (data.session) {
          const { access_token, refresh_token } = data.session;
          // setSession expects a single access token, refresh_token is handled automatically
          if (access_token) {
            const { error } = await supabase.auth.setSession(access_token);
            if (error) throw error;
          }
        }

    return true;
  } catch (error) {
    console.error("Biometric authentication failed:", error);
    throw error;
  }
}

// Remove a WebAuthn credential
export async function removeCredential(credentialId: string, email: string): Promise<boolean> {
  const response = await fetch("/api/webauthn/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentialId, email }),
  });

  return response.ok;
}