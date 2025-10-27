import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { componentTypes } from "./components";
import { pageType } from "./pages";

const Header = componentTypes.header;
const Sidebar = componentTypes.sideBar;
const Dashboard = pageType.dashboard;
const Annotate = pageType.annotate;
const Projects = pageType.projects;
const Datasets = pageType.datasets;

export default function App() {
  return (
    <Router>
      <div className="d-flex flex-column vh-100 bg-gray-900 text-gray-100">
        {/* Header (fixed height) */}
        <Header />

        {/* Content area fills remaining space */}
        <div
          className="d-flex flex-grow-1 overflow-hidden"
          style={{ height: "calc(100vh - 60px)" }} // 60px = header height
        >
          {/* Sidebar (full height) */}
          <div className="h-100">
            <Sidebar />
          </div>

          {/* Main content */}
          <main
            className="flex-grow-1 p-4 overflow-auto"
            style={{
              backgroundColor: "#0e0e0e",
              borderLeft: "1px solid #333",
            }}
          >
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/annotate" element={<Annotate />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/datasets" element={<Datasets />} />
            </Routes>
          </main>
        </div>
      </div>
    </Router>
  );
}
