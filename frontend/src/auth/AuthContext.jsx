import React, { createContext, useContext, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth } from "./firebase"; 

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ✅ Enable/Disable Auth from .env
  const ENABLE_AUTH = import.meta.env.VITE_ENABLE_AUTH === "true";

  // Watch for auth state changes
  useEffect(() => {
    if (!ENABLE_AUTH) {
      // Mock user for offline mode
      setUser({
        uid: "offline-user",
        displayName: "Offline User",
        email: "offline@hexlabel.local",
        photoURL: null,
        isOffline: true
      });
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [ENABLE_AUTH]);

  // ✅ Signup with Email & Password
  const signup = async (email, password, displayName) => {
    if (!ENABLE_AUTH) return;
    try {
      setError("");
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName });
      setUser(userCredential.user);
    } catch (err) {
      setError(err.message);
    }
  };

  // ✅ Login with Email & Password
  const login = async (email, password) => {
    if (!ENABLE_AUTH) return;
    try {
      setError("");
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err.message);
    }
  };

  // ✅ Login with Google
  const loginWithGoogle = async () => {
    if (!ENABLE_AUTH) return;
    try {
      setError("");
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Google Sign-in Error:", err);
      setError(err.message);
    }
  };

  // ✅ Password Reset
  const resetPassword = async (email) => {
    if (!ENABLE_AUTH) return;
    try {
      setError("");
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      setError(err.message);
    }
  };

  // ✅ Logout
  const logout = async () => {
    if (!ENABLE_AUTH) {
      setUser(null);
      return;
    }
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout Error:", err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        signup,
        login,
        loginWithGoogle, // ✅ Added Google login here
        resetPassword,
        logout,
        ENABLE_AUTH,
      }}
    >
      {!loading && children}
    </AuthContext.Provider>
  );
};

// ✅ Custom Hook
export const useAuth = () => useContext(AuthContext);
