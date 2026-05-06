// frontend/src/App.jsx
import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { componentTypes } from "./components";
import { pageType } from "./pages";
import { useTheme } from "./components/ThemeContext";
import "/src/css/global.css";

const Header = componentTypes.header;
const Sidebar = componentTypes.sideBar;
const Dashboard = pageType.dashboard;
const Annotate = pageType.annotate;
const Projects = pageType.projects;
const Datasets = pageType.datasets;
const ProjectPage = pageType.projectPage;
const DatasetPage = pageType.datasetPage; 

export default function App() {
  const { themeColors, theme } = useTheme();
  
  return (
    <Router>
      <div className="d-flex flex-column vh-100 bg-gray-900 text-gray-100">
        {/* Header */}
        <Header />

        <div className="d-flex flex-grow-1 overflow-hidden" style={{ height: "calc(100vh - 60px)" }}>
          <div className="h-100">
            <Sidebar />
          </div>

          <main
            className="flex-grow-1"
            style={{
              backgroundColor: themeColors.background,
              borderLeft: "1px solid #333",
              margin:"0"
            }}
          >
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/datasets" element={<Datasets />} />
              <Route path="/project/:projectId" element={<ProjectPage />} /> {/* ✅ Added */}
              <Route path="/project/:projectId/dataset/:datasetId" element={<DatasetPage />} />
              <Route path="/annotate" element={<Annotate />} />
              <Route path="/annotate/:projectId/:datasetId/:jobId" element={<Annotate />} />


            </Routes>
          </main>
        </div>
      </div>
    </Router>
  );
}
