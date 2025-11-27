// src/theme/ThemeContext.jsx
import React, { createContext, useState, useContext, useEffect } from "react";

export const lightTheme = {
  background: "#ffffff",
  headerBg: "#f8f9fa",
  toolbarBg: "#e9ecef",
  sidebarBg: "#f1f3f5",

  text: "#212529",
  subtleText: "#6b7280",
  placeholderText: "#6b7280",

  cardBg: "#ffffff",
  surface: "#eeeeee",
  border: "#dee2e6",

  inputBg: "#ffffff",
  inputText: "#212529",

  buttonBg: "#ffffff",
  buttonText: "#212529",
  hoverBg: "#e9ecef",

  primary: "#0066cc",
  accent: "#33ccff",
  link: "#4f8cff",
  error: "#ff4d4d",

  shadow: "rgba(22, 10, 122, 0.30)",
};

export const darkTheme = {
  background: "#121212",
  headerBg: "#1e1e1e",
  toolbarBg: "#2c2c2c",
  sidebarBg: "#252525",

  text: "#ffffff",
  subtleText: "#94a3b8",
  placeholderText: "#aaaaaa",

  cardBg: "#1e1e1e",
  surface: "#2b2b3d",
  border: "#444444",

  inputBg: "#2c2c2c",
  inputText: "#ffffff",

  buttonBg: "#2e2e2e",
  buttonText: "#ffffff",
  hoverBg: "#3d3d3d",

  primary: "#3388ff",
  accent: "#55aaff",
  link: "#6aa8ff",
  error: "#ff6b6b",

  shadow: "rgba(0,0,0,0.40)",
};

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState("dark");
  const themeColors = theme === "light" ? lightTheme : darkTheme;

  // Load saved theme
  useEffect(() => {
    const saved = localStorage.getItem("app-theme");
    if (saved) setTheme(saved);
  }, []);

  // Save theme
  useEffect(() => {
    localStorage.setItem("app-theme", theme);
  }, [theme]);

  // Inject CSS variables globally
  useEffect(() => {
    const root = document.documentElement;

    Object.entries(themeColors).forEach(([key, value]) => {
      root.style.setProperty(`--${key}`, value);
    });

    root.style.setProperty("--scroll-primary", themeColors.primary);
    root.style.setProperty("--scroll-accent", themeColors.accent);
  }, [themeColors]);

  const toggleTheme = () =>
    setTheme((prev) => (prev === "light" ? "dark" : "light"));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, themeColors }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
