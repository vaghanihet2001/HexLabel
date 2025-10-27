// src/theme/ThemeContext.jsx
import React, { createContext, useState, useContext, useEffect } from "react";
import { Placeholder } from "react-bootstrap";

// --- Centralized color palette ---
export const lightTheme = {
  background: "#ffffff",
  headerBg: "#f8f9fa",
  toolbarBg: "#e9ecef",
  sidebarBg: "#f1f3f5",
  text: "#212529",
  border: "#dee2e6",
  nodeBg: "#e3f2fd",
  edgeColor: "#000000",
  cardBg: "#ffffff",
  inputBg: "#ffffff",
  inputText: "#212529",
  placeholderText : "#212529",
  buttonBg: "#ffffff",
  buttonText: "#212529",
  hoverBg: "#e9ecef",
};

export const darkTheme = {
  background: "#121212",
  headerBg: "#1e1e1e",
  toolbarBg: "#2c2c2c",
  sidebarBg: "#252525",
  text: "#ffffff",
  border: "#333333",
  nodeBg: "#2b2b2b",
  edgeColor: "#ffffff",
  cardBg: "#2c2c2c",
  inputBg: "#2c2c2c",
  inputText: "#ffffff",
  placeholderText : "#ffffff",
  buttonBg: "#2c2c2c",
  buttonText: "#ffffff",
  hoverBg: "#3a3a3a",
};

// --- Theme Context ---
const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState("dark");

  // Load saved theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem("app-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  // Save theme to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("app-theme", theme);
  }, [theme]);

  // Toggle theme
  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  // Current theme colors
  const themeColors = theme === "light" ? lightTheme : darkTheme;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, themeColors }}>
      {children}
    </ThemeContext.Provider>
  );
};

// --- Custom hook for using theme ---
export const useTheme = () => useContext(ThemeContext);
