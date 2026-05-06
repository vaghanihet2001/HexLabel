// frontend/src/components/Header.jsx
import React, { useState } from "react";
import {
  FaGithub,
  FaLinkedin,
  FaEnvelope,
  FaInfoCircle,
  FaSun,
  FaMoon,
  FaUserCircle,
  FaGlobe,
} from "react-icons/fa";
import "bootstrap/dist/css/bootstrap.min.css";
import { useTheme } from "./ThemeContext";
import { useAuth } from "../auth/AuthContext";
import logo from "../assets/logo-removebg.png";

const HEADER_HEIGHT = 60;

const Header = () => {
  const [infoOpen, setInfoOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { theme, toggleTheme, themeColors } = useTheme();
  const { user, logout } = useAuth();

  const developerInfo = {
    name: "Het Vaghani",
    github: "https://github.com/vaghanihet2001",
    linkedin: "https://www.linkedin.com/in/ai-ml-developer",
    email: "vaghanihet2001@gmail.com",
    website: "https://hexverce.in/",
  };

  const buttonStyle = {
    width: "40px",
    height: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "5px",
    border: `1px solid ${themeColors.border}`,
    backgroundColor: themeColors.cardBg,
    color: themeColors.text,
    cursor: "pointer",
  };

  return (
    <header
      className="d-flex align-items-center justify-content-between px-3"
      style={{
        height: HEADER_HEIGHT,
        borderBottom: `1px solid ${themeColors.border}`,
        color: themeColors.text,
        backgroundColor: themeColors.headerBg,
        position: "relative",
      }}
    >
      {/* Logo */}
      <div className="d-flex align-items-center gap-2">
        <img
          src={logo}
          alt="HEX Logo"
          className="img-fluid"
          style={{ height: "40px" }}
        />
        <span className="fw-bold fs-3 text-gradient-primary">HexLabel</span>
      </div>

      {/* Right side buttons */}
      <div className="d-flex align-items-center gap-2">
        {/* Theme Toggle */}
        <button style={buttonStyle} onClick={toggleTheme}>
          {theme === "light" ? <FaMoon /> : <FaSun />}
        </button>

        {/* Info Button */}
        <div className="position-relative">
          <button style={buttonStyle} onClick={() => setInfoOpen(!infoOpen)}>
            <FaInfoCircle size={22} />
          </button>

          {infoOpen && (
            <div
              className="card position-absolute end-0 mt-2"
              style={{
                width: "220px",
                zIndex: 1000,
                backgroundColor: themeColors.cardBg,
                color: themeColors.text,
              }}
            >
              <div className="card-body p-3">
                <h6 className="card-title mb-3">Made by: {developerInfo.name}</h6>
                <div className="d-flex flex-column gap-2">
                  <a
                    href={developerInfo.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="d-flex align-items-center text-decoration-none gap-2"
                    style={{ color: themeColors.text }}
                  >
                    <FaGithub /> GitHub
                  </a>
                  <a
                    href={developerInfo.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="d-flex align-items-center text-decoration-none gap-2"
                    style={{ color: themeColors.text }}
                  >
                    <FaLinkedin /> LinkedIn
                  </a>
                  <a
                    href={`mailto:${developerInfo.email}`}
                    className="d-flex align-items-center text-decoration-none gap-2"
                    style={{ color: themeColors.text }}
                  >
                    <FaEnvelope /> Email
                  </a>
                  <a
                    href={`${developerInfo.website}`}
                    className="d-flex align-items-center text-decoration-none gap-2"
                    style={{ color: themeColors.text }}
                  >
                    <FaGlobe /> Hexverce Website
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Icon / Menu */}
        <div className="position-relative">
          <button
            style={buttonStyle}
            onClick={() => setUserMenuOpen(!userMenuOpen)}
          >
            {user && user.photoURL ? (
              <img
                src={user.photoURL}
                alt="User Avatar"
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  objectFit: "cover",
                }}
              />
            ) : (
              <FaUserCircle size={22} />
            )}
          </button>

          {/* User Menu */}
          {userMenuOpen && user && (
            <div
              className="card position-absolute end-0 mt-2"
              style={{
                width: "250px",
                zIndex: 1000,
                backgroundColor: themeColors.cardBg,
                color: themeColors.text,
              }}
            >
              <div className="card-body p-3 text-center">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="User"
                    style={{
                      width: "60px",
                      height: "60px",
                      borderRadius: "50%",
                      objectFit: "cover",
                      marginBottom: "10px",
                    }}
                  />
                ) : (
                  <FaUserCircle size={48} className="mb-2" />
                )}
                <h6 className="mb-1">{user.displayName || "User"}</h6>
                <p
                  className="mb-3"
                  style={{
                    fontSize: "0.85rem",
                    color: themeColors.subtleText || themeColors.text,
                    opacity: 0.8,
                  }}
                >
                  {user.email}
                </p>

                {import.meta.env.VITE_ENABLE_AUTH === "true" && (
                  <button
                    className="btn btn-danger btn-sm w-100"
                    onClick={() => {
                      logout();
                      setUserMenuOpen(false);
                    }}
                  >
                    Sign Out
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
export { HEADER_HEIGHT };
