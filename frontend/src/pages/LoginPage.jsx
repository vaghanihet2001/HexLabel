// frontend/src/pages/LoginPage.jsx
import React, { useState } from "react";
import { FaGoogle } from "react-icons/fa";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../components/ThemeContext";
import logo from "../assets/logo-removebg.png";

const LoginPage = () => {
  const [authMode, setAuthMode] = useState("login"); // 'login', 'signup', or 'reset'
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

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: themeColors.background,
        color: themeColors.text,
        fontFamily: "Inter, sans-serif",
        transition: "all 0.3s ease",
      }}
    >
      {/* Left side - Illustration */}
      <div
        style={{
          flex: 1,
          background: `linear-gradient(135deg, ${themeColors.primary}, ${themeColors.accent})`,
          color: "white",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          transition: "all 0.3s ease",
        }}
      >
        <img
          src={logo}
          alt="HexLabel Logo"
          style={{ width: "120px", marginBottom: "1.5rem" }}
        />
        <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "0.5rem" }}>
          Welcome to HexLabel
        </h1>
        <p style={{ fontSize: "1rem", maxWidth: "300px", textAlign: "center" }}>
          Anotate your data with ease,learn computer vision and grow.
        </p>
      </div>

      {/* Right side - Auth box */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: themeColors.cardBg,
          transition: "all 0.3s ease",
        }}
      >
        <div
          style={{
            background: themeColors.surface || themeColors.cardBg,
            padding: "2.5rem",
            borderRadius: "12px",
            boxShadow: `0 0 25px ${themeColors.shadow || "rgba(0,0,0,0.3)"}`,
            width: "360px",
            color: themeColors.text,
            transition: "all 0.3s ease",
          }}
        >
          <h3 className="text-center mb-4" style={{ color: themeColors.text }}>
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
                className="form-control mb-3"
                placeholder="Full Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                style={{
                  backgroundColor: themeColors.inputBg,
                  color: themeColors.text,
                  border: `1px solid ${themeColors.border}`,
                  
                } }
              />
            )}
            <input
              type="email"
              className="form-control mb-3"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                backgroundColor: themeColors.inputBg,
                color: themeColors.text,
                border: `1px solid ${themeColors.border}`,
              }}
            />
            {authMode !== "reset" && (
              <input
                type="password"
                className="form-control mb-3"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  backgroundColor: themeColors.inputBg,
                  color: themeColors.text,
                  border: `1px solid ${themeColors.border}`,
                }}
              />
            )}
            <button
              type="submit"
              className="btn w-100"
              style={{
                backgroundColor: themeColors.primary,
                color: "#fff",
                border: "none",
                fontWeight: "bold",
                marginBottom: "15px",
                transition: "background 0.3s ease",
              }}
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
              className="btn w-100"
              style={{
                backgroundColor: themeColors.googleBtnBg || "#ffffff",
                color: themeColors.googleBtnText || "#333",
                fontWeight: "500",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                padding: "10px",
                borderRadius: "6px",
                border: `1px solid ${themeColors.border}`,
              }}
            >
              <FaGoogle color="#DB4437" /> Sign in with Google
            </button>
          )}

          {error && (
            <p
              className="mt-3 text-center"
              style={{
                fontSize: "0.9rem",
                color: themeColors.error || "#ff6b6b",
              }}
            >
              {error}
            </p>
          )}

          {/* Mode Switch */}
          <div className="text-center mt-4">
            {authMode === "login" ? (
              <>
                <p>
                  Don’t have an account?{" "}
                  <button
                    className="btn btn-link p-0"
                    style={{ color: themeColors.link }}
                    onClick={() => setAuthMode("signup")}
                  >
                    Sign Up
                  </button>
                </p>
                <button
                  className="btn btn-link p-0"
                  style={{ color: themeColors.link }}
                  onClick={() => setAuthMode("reset")}
                >
                  Forgot Password?
                </button>
              </>
            ) : (
              <button
                className="btn btn-link p-0"
                style={{ color: themeColors.link }}
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
