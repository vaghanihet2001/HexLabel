// src/pages/AuthPage.jsx
import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext";

const AuthPage = () => {
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const { login, signup, resetPassword, error } = useAuth();

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
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Left Side — Design */}
      <div
        style={{
          flex: 1,
          background:
            "linear-gradient(135deg, #3a0ca3, #7209b7, #f72585)",
          color: "white",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
        }}
      >
        <img
          src="src/assets/logo-removebg.png"
          alt="HexFlow"
          style={{ width: "120px", marginBottom: "1rem" }}
        />
        <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Welcome to HexFlow</h1>
        <p style={{ fontSize: "1rem", opacity: 0.9, maxWidth: "300px", textAlign: "center" }}>
          Build, Connect, and Visualize your AI Workflows Seamlessly.
        </p>
      </div>

      {/* Right Side — Auth Box */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f8f9fa",
        }}
      >
        <div
          style={{
            background: "white",
            padding: "2.5rem",
            borderRadius: "12px",
            boxShadow: "0 0 25px rgba(0,0,0,0.1)",
            width: "360px",
          }}
        >
          <h3 className="text-center mb-4" style={{ color: "#333" }}>
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
              />
            )}
            <input
              type="email"
              className="form-control mb-3"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {authMode !== "reset" && (
              <input
                type="password"
                className="form-control mb-3"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}
            <button type="submit" className="btn btn-primary w-100">
              {authMode === "login"
                ? "Login"
                : authMode === "signup"
                ? "Sign Up"
                : "Send Reset Link"}
            </button>
          </form>

          {error && <p className="text-danger mt-3 text-center">{error}</p>}

          <div className="text-center mt-3">
            {authMode === "login" ? (
              <>
                <p>
                  Don’t have an account?{" "}
                  <button
                    className="btn btn-link p-0"
                    onClick={() => setAuthMode("signup")}
                  >
                    Sign Up
                  </button>
                </p>
                <button
                  className="btn btn-link p-0"
                  onClick={() => setAuthMode("reset")}
                >
                  Forgot Password?
                </button>
              </>
            ) : (
              <button
                className="btn btn-link p-0"
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

export default AuthPage;
