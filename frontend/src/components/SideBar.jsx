import React, { useState } from "react";
import { Nav, Button, OverlayTrigger, Tooltip, Modal } from "react-bootstrap";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "./ThemeContext";
import {
  Layers,
  Folder,
  Database,
  PenTool,
  ChevronLeft,
  ChevronRight,
  UserCircle2,
  LogIn,
  LogOut,
} from "lucide-react";

export default function Sidebar() {
  const { themeColors } = useTheme();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  const navItems = [
    { path: "/", label: "Dashboard", icon: <Layers size={18} /> },
    { path: "/projects", label: "Projects", icon: <Folder size={18} /> },
    { path: "/annotate", label: "Annotate", icon: <PenTool size={18} /> },
    { path: "/datasets", label: "Datasets", icon: <Database size={18} /> },
  ];

  const handleAuthClick = () => setShowAuthModal(true);

  const handleSignInOut = () => {
    setIsSignedIn((prev) => !prev);
    setShowAuthModal(false);
  };

  return (
    <div
      style={{
        width: collapsed ? "70px" : "240px",
        backgroundColor: themeColors.sidebarBg,
        borderRight: `1px solid ${themeColors.border}`,
        color: themeColors.text,
        transition: "width 0.3s ease-in-out",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Toggle button */}
      <Button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          position: "absolute",
          top: "50%",
          right: "-14px",
          transform: "translateY(-50%)",
          backgroundColor: themeColors.cardBg,
          border: `1px solid ${themeColors.border}`,
          borderRadius: "50%",
          padding: "6px",
          width: "32px",
          height: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
          transition: "all 0.2s ease-in-out",
          zIndex: 20,
        }}
      >
        {collapsed ? (
          <ChevronRight size={16} color={themeColors.text} />
        ) : (
          <ChevronLeft size={16} color={themeColors.text} />
        )}
      </Button>

      {/* Nav items */}
      <Nav className="flex-column mt-4 w-100">
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          const navLink = (
            <Link
              to={item.path}
              className="d-flex align-items-center rounded text-decoration-none"
              style={{
                backgroundColor: active ? themeColors.hoverBg : "transparent",
                color: themeColors.text,
                padding: collapsed ? "10px" : "10px 16px",
                justifyContent: collapsed ? "center" : "flex-start",
                borderRadius: "8px",
                margin: "4px 10px",
                transition: "all 0.2s ease-in-out",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: collapsed ? "0" : "10px",
                  width: "100%",
                  justifyContent: collapsed ? "center" : "flex-start",
                }}
              >
                {item.icon}
                {!collapsed && <span>{item.label}</span>}
              </div>
            </Link>
          );

          return (
            <Nav.Item key={item.path}>
              {collapsed ? (
                <OverlayTrigger
                  placement="right"
                  overlay={<Tooltip>{item.label}</Tooltip>}
                >
                  {navLink}
                </OverlayTrigger>
              ) : (
                navLink
              )}
            </Nav.Item>
          );
        })}
      </Nav>

      {/* User section */}
      <div
        onClick={handleAuthClick}
        style={{
          margin: "auto 0 20px 0",
          textAlign: "center",
          cursor: "pointer",
          padding: "8px 0",
          borderTop: `1px solid ${themeColors.border}`,
        }}
      >
        <UserCircle2
          size={collapsed ? 26 : 34}
          color={themeColors.text}
          style={{ opacity: 0.9 }}
        />
        {!collapsed && (
          <div style={{ fontSize: "0.9rem", marginTop: "4px", opacity: 0.8 }}>
            {isSignedIn ? "My Account" : "Sign In"}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="text-center w-100"
        style={{
          fontSize: "0.8rem",
          color: themeColors.text,
          opacity: 0.5,
          marginBottom: "8px",
        }}
      >
        {!collapsed && `© ${new Date().getFullYear()} Hex Ecosystem`}
      </div>

      {/* Auth Modal */}
      <Modal
        show={showAuthModal}
        onHide={() => setShowAuthModal(false)}
        centered
        backdrop="static"
      >
        <Modal.Header
          closeButton
          style={{
            backgroundColor: themeColors.cardBg,
            color: themeColors.text,
            borderBottom: `1px solid ${themeColors.border}`,
          }}
        >
          <Modal.Title>{isSignedIn ? "My Account" : "Welcome"}</Modal.Title>
        </Modal.Header>
        <Modal.Body
          style={{
            backgroundColor: themeColors.cardBg,
            color: themeColors.text,
          }}
        >
          {isSignedIn ? (
            <p>You're currently signed in. Would you like to sign out?</p>
          ) : (
            <p>Please sign in to your HexLabel account to sync your projects.</p>
          )}
        </Modal.Body>
        <Modal.Footer
          style={{
            backgroundColor: themeColors.cardBg,
            borderTop: `1px solid ${themeColors.border}`,
          }}
        >
          <Button
            variant="secondary"
            onClick={() => setShowAuthModal(false)}
            style={{
              backgroundColor: themeColors.buttonBg,
              color: themeColors.buttonText,
              border: `1px solid ${themeColors.border}`,
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSignInOut}
            style={{
              backgroundColor: themeColors.hoverBg,
              color: themeColors.text,
              border: `1px solid ${themeColors.border}`,
            }}
          >
            {isSignedIn ? (
              <>
                <LogOut size={16} className="me-1" /> Sign Out
              </>
            ) : (
              <>
                <LogIn size={16} className="me-1" /> Sign In
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
