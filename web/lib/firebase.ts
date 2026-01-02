import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? ''
};

export function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseConfig.databaseURL) {
    return null;
  }

  if (!getApps().length) {
    return initializeApp(firebaseConfig);
  }

  return getApps()[0] ?? null;
}
