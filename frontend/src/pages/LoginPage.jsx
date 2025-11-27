import React, { useState } from "react";
import { FaGoogle } from "react-icons/fa";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../components/ThemeContext";
import styles from "./LoginPage.module.css"; // Correct import for CSS Module

const LoginPage = () => {
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const { login, signup, resetPassword, loginWithGoogle, error } = useAuth();
  const { themeColors } = useTheme();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (authMode === "login") await login(email, password);
    else if (authMode === "signup") await signup(email, password, displayName);
    else if (authMode === "reset") await resetPassword(email);
  };

  // Define CSS variables as an object to pass to the root element's style prop
  // Added fallback values for safety, though themeColors should ideally be complete
  const cssVariables = {
    "--background-color": themeColors.background || "#f0f2f5",
    "--text-color": themeColors.text || "#333",
    "--primary-color": themeColors.primary || "#007bff",
    "--accent-color": themeColors.accent || "#6c757d", // For the gradient
    "--surface-color": themeColors.surface || themeColors.cardBg || "#ffffff",
    "--shadow-color": themeColors.shadow || "rgba(0,0,0,0.3)",
    "--input-bg-color": themeColors.inputBg || "#f8f9fa",
    "--border-color": themeColors.border || "#ced4da",
    "--placeholder-color": themeColors.text || "#6c757d", // Placeholder often slightly lighter
    "--google-btn-bg-color": themeColors.googleBtnBg || "#ffffff",
    "--google-btn-text-color": themeColors.googleBtnText || "#333",
    "--error-color": themeColors.error || "#ff6b6b",
    "--link-color": themeColors.link || "#007bff",
  };

  return (
    
    // Apply the main container class and CSS variables
    <div className={styles.container} style={cssVariables}>
      {/* Left side - Illustration */}
      <div className={styles.illustrationSide}>
      
        <img
          src="/src/assets/logo-removebg.png"
          alt="HexLabel Logo"
          className={styles.logo}
        />
        <h1 className={styles.illustrationTitle}>Welcome to HexLabel</h1>
        <p className={styles.illustrationText}>
          Annotate your images with ease.
        </p>
      </div>

      {/* Right side - Auth box */}
      <div
        className={styles.authSide}
        // Background gradient still needs to be inline as it's a function of two variables
        style={{
          background: `linear-gradient(135deg, ${cssVariables["--primary-color"]}, ${cssVariables["--accent-color"]})`,
        }}
      >
        <div className={styles.authBox}>
          <h3 className={styles.authTitle}>
            {authMode === "login"
              ? "Login"
              : authMode === "signup"
              ? "Create Account"
              : "Reset Password"}
          </h3>

          <form onSubmit={handleSubmit}>
            {authMode === "signup" && (
              <input
                type="text"
                // Combine custom inputField class with Bootstrap's form-control and mb-3
                className={`${styles.inputField} form-control mb-3`}
                placeholder="Full Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            )}
            <input
              type="email"
              className={`${styles.inputField} form-control mb-3`}
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {authMode !== "reset" && (
              <input
                type="password"
                className={`${styles.inputField} form-control mb-3`}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}
            <button
              type="submit"
              // Combine custom submitButton class with Bootstrap's btn and w-100
              className={`${styles.submitButton} btn w-100`}
            >
              {authMode === "login"
                ? "Login"
                : authMode === "signup"
                ? "Sign Up"
                : "Send Reset Link"}
            </button>
          </form>

          {/* Google Sign-In Button */}
          {authMode === "login" && (
            <button
              onClick={loginWithGoogle}
              // Combine custom googleButton class with Bootstrap's btn and w-100
              className={`${styles.googleButton} btn w-100`}
            >
              <FaGoogle color="#DB4437" /> Sign in with Google
            </button>
          )}

          {error && (
            // Combine custom errorMessage class with Bootstrap's mt-3 and text-center
            <p className={`${styles.errorMessage} mt-3 text-center`}>
              {error}
            </p>
          )}

          {/* Mode Switch */}
          <div className={`${styles.modeSwitchContainer} text-center mt-4`}>
            {authMode === "login" ? (
              <>
                <p>
                  Don’t have an account?{" "}
                  <button
                    // Combine custom linkButton class with Bootstrap's btn, btn-link, p-0
                    className={`${styles.linkButton} btn btn-link p-0`}
                    onClick={() => setAuthMode("signup")}
                  >
                    Sign Up
                  </button>
                </p>
                <button
                  className={`${styles.linkButton} btn btn-link p-0`}
                  onClick={() => setAuthMode("reset")}
                >
                  Forgot Password?
                </button>
              </>
            ) : (
              <button
                className={`${styles.linkButton} btn btn-link p-0`}
                onClick={() => setAuthMode("login")}
              >
                Back to Login
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;