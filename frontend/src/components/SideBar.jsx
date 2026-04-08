import React, { useState } from "react";
import { Nav, Button, OverlayTrigger, Tooltip } from "react-bootstrap";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "./ThemeContext";
import {
  Layers,
  Folder,
  PenTool,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export default function Sidebar() {
  const { themeColors } = useTheme();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    { path: "/", label: "Dashboard", icon: <Layers size={18} /> },
    { path: "/projects", label: "Projects", icon: <Folder size={18} /> },
    // { path: "/annotate", label: "Annotate", icon: <PenTool size={18} /> },
    { path: "/settings", label: "Settings", icon: <Settings size={18} /> },
  ];

  return (
    <div
      className="sidebar-wrapper"
      style={{
        width: collapsed ? "70px" : "240px",
        transition: "width 0.3s ease-in-out",
      }}
    >
      {/* Collapse toggle */}
      <Button
        className="sidebar-toggle-btn"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </Button>

      {/* Nav items */}
      <Nav className="flex-column mt-4 w-100">
        {navItems.map((item) => {
          const active = location.pathname === item.path;

          const navLink = (
            <Link
              to={item.path}
              className={`sidebar-nav-item ${
                active ? "active-sidebar-item" : ""
              } ${collapsed ? "collapsed" : ""}`}
            >
              <div className="sidebar-item-inner">
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

      {/* Footer */}
      <div className={`sidebar-footer ${collapsed ? "collapsed" : ""}`}>
        {!collapsed && `© ${new Date().getFullYear()} HexLabel by Hexverce`}
      </div>
    </div>
  );
}
