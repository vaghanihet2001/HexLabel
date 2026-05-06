// src/auth/firebase.js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { getAnalytics, logEvent, isSupported } from "firebase/analytics";

// ✅ Enable/Disable Auth from .env
const ENABLE_AUTH = import.meta.env.VITE_ENABLE_AUTH === "true";

let app = null;
let auth = null;
let provider = null;
let analytics = null;

if (ENABLE_AUTH) {
  // ✅ Your Firebase configuration
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  };

  // ✅ Initialize Firebase
  app = initializeApp(firebaseConfig);

  // ✅ Initialize Auth
  auth = getAuth(app);
  auth.languageCode = "en";

  // ✅ Google Provider
  provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: "select_account", // always ask to choose account
  });

  // ✅ Initialize Analytics safely
  isSupported()
    .then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
        logEvent(analytics, "firebase_initialized");
      }
    })
    .catch(() => {
      console.warn("⚠️ Firebase Analytics not supported in this environment.");
    });
} else {
  console.log("🛠️ Firebase Auth is DISABLED via .env. Running in offline mode.");
}

// ✅ Export Firebase utilities
export {
  app,
  auth,
  provider,
  analytics,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
};
