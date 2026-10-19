import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  createLazyInitializer,
  resolveFirebaseAdminPrivateKey,
} from "./firebase-admin-config";

function initializeFirebaseAdmin(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID
    || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = resolveFirebaseAdminPrivateKey({
    privateKeyBase64: process.env.FIREBASE_ADMIN_PRIVATE_KEY_BASE64,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY,
  });

  if (projectId && clientEmail && privateKey) {
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
  }

  return initializeApp({ credential: applicationDefault(), projectId });
}

const initializeAdminAppOnce = createLazyInitializer(initializeFirebaseAdmin);

export function getFirebaseAdminApp(): App {
  return initializeAdminAppOnce();
}

export function getFirebaseAdminAuth(): Auth {
  return getAuth(getFirebaseAdminApp());
}

export function getFirebaseAdminFirestore(): Firestore {
  return getFirestore(getFirebaseAdminApp());
}
