// src/components/Header.jsx
import React, { useState } from "react";
import {
  FaGithub,
  FaLinkedin,
  FaEnvelope,
  FaInfoCircle,
  FaSun,
  FaMoon,
} from "react-icons/fa";
import "bootstrap/dist/css/bootstrap.min.css";
import { useTheme } from "./ThemeContext";

const HEADER_HEIGHT = 60;

const Header = () => {
  const [infoOpen, setInfoOpen] = useState(false);

  const developerInfo = {
    name: "Het Vaghani",
    github: "https://github.com/vaghanihet2001",
    linkedin: "https://www.linkedin.com/in/ai-ml-developer",
    email: "vaghanihet2001@gmail.com",
  };

  const { theme, toggleTheme, themeColors } = useTheme();

  // Common button style to match info button
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
        position: "relative",
        color: themeColors.text,
        backgroundColor: themeColors.headerBg,
      }}
    >
      {/* Logo and App Name */}
      <div className="d-flex align-items-center gap-2">
        <img
          src="src/assets/logo-removebg.png"
          alt="HEX Logo"
          className="img-fluid"
          style={{ height: "40px" }}
        />
        <span className="fw-bold fs-5">HexLabel</span>
      </div>

      {/* Right-side controls: theme switch + developer info */}
      <div className="d-flex align-items-center gap-2">
        {/* Theme Switch Button */}
        <button style={buttonStyle} onClick={toggleTheme}>
          {theme === "light" ? <FaMoon /> : <FaSun />}
        </button>

        {/* Developer Info Button */}
        <div className="position-relative">
          <button
            style={buttonStyle}
            onClick={() => setInfoOpen(!infoOpen)}
          >
            <FaInfoCircle size={22} />
          </button>

          {/* Info Panel */}
          {infoOpen && (
            <div
              className="card position-absolute end-0 mt-2"
              style={{
                width: "220px",
                zIndex: 1000,
                backgroundColor: themeColors.cardBg,
                color: themeColors.text,
                top: "100%", // appear below the button
              }}
            >
              <div className="card-body p-3">
                <h6
                  className="card-title mb-3"
                  style={{ whiteSpace: "normal", wordBreak: "break-word" }}
                >
                  Made by : 
                  {developerInfo.name}
                </h6>
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
                </div>
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
