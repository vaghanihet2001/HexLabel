// frontend/src/pages/DatasetPage.jsx
import React, { useState, useEffect } from "react";
import { Tabs, Tab, Button } from "react-bootstrap";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useTheme } from "../components/ThemeContext";

import UploadImagesPage from "./dataset/UploadImagesPage";
import AnnotationTasksPage from "./dataset/AnnotationTasksPage";
import DatasetGalleryPage from "./dataset/DatasetGalleryPage";
import VersionsPage from "./dataset/VersionsPage";
import ClassesTagsPage from "./dataset/ClassesTagsPage";

import { db } from "../utils/db";
import "../css/dataset-tabs.css";

export default function DatasetPage() {
  const { projectId, datasetId } = useParams();
  const navigate = useNavigate();
  const { themeColors } = useTheme();

  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    return searchParams.get("tab") || localStorage.getItem("hexlabel-dataset-tab") || "upload";
  });
  const [jobRefresh, setJobRefresh] = useState(0);

  // Sync tab state to URL and LocalStorage
  const handleSelectTab = (k) => {
    setActiveTab(k);
    localStorage.setItem("hexlabel-dataset-tab", k);
    setSearchParams((prev) => {
      prev.set("tab", k);
      return prev;
    }, { replace: true });
  };

  const [project, setProject] = useState(null);
  const [dataset, setDataset] = useState(null);

  // --------------------------------------------
  // LOAD PROJECT + DATASET
  // --------------------------------------------
  useEffect(() => {
    const loadData = async () => {
      const proj = await db.projects.get(projectId);
      const ds = await db.datasets.get(datasetId);

      setProject(proj);
      setDataset(ds);
    };
    loadData();
  }, [projectId, datasetId]);

  // --------------------------------------------
  // JOB CREATED → SWITCH TO JOB TAB
  // --------------------------------------------
  const handleJobCreated = () => {
    handleSelectTab("jobs");
    setJobRefresh((p) => p + 1);
  };

  // --------------------------------------------
  // LOADING UI
  // --------------------------------------------
  if (!project || !dataset) {
    return (
      <div className="p-4" style={{ color: themeColors.text }}>
        Loading dataset...
      </div>
    );
  }

  return (
    <div
      className="p-4"
      style={{
        backgroundColor: themeColors.background,
        color: themeColors.text,
        height: "calc(100vh - 60px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* HEADER */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="d-flex align-items-center">
          <Button
            variant="outline-secondary"
            className="me-3"
            onClick={() => navigate(`/project/${projectId}`)}
            style={{
              backgroundColor: themeColors.cardBg,
              borderColor: themeColors.border,
              color: themeColors.text,
            }}
          >
            ← Back
          </Button>

          <h3 className="fw-semibold mb-0" style={{ color: themeColors.text }}>
            Dataset: {dataset.name}
          </h3>
        </div>
      </div>

      {/* MAIN TAB SYSTEM */}
      <div
        style={{
          backgroundColor: themeColors.cardBg,
          borderRadius: "8px",
          padding: "0.5rem",
          border: `1px solid ${themeColors.border}`,
          flexGrow: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* TAB BAR */}
        <Tabs
          activeKey={activeTab}
          onSelect={handleSelectTab}
          justify
          className="custom-hex-tabs"
          style={{
            borderBottom: `1px solid ${themeColors.border}`,

          }}
        >
          <Tab eventKey="upload" title="📤 Upload Images" />
          <Tab eventKey="jobs" title="🧩 Jobs" />
          <Tab eventKey="dataset" title="🖼 Dataset" />
          <Tab eventKey="versions" title="📦 Versions" />
          <Tab eventKey="classes" title="🏷 Classes & Tags" />
        </Tabs>

        {/* TAB CONTENT */}
        <div style={{ flexGrow: 1, overflowY: "auto", marginTop: "1rem" }}>
          {activeTab === "upload" && (
            <UploadImagesPage
              dataset={dataset}
              project={project}
              datasetId={dataset.id}
              projectId={project.id}
              onJobCreated={handleJobCreated}
            />
          )}

          {activeTab === "jobs" && (
            <AnnotationTasksPage
              dataset={dataset}
              project={project}
              datasetId={dataset.id}
              projectId={project.id}
              jobRefresh={jobRefresh}
            />
          )}

          {activeTab === "dataset" && (
            <DatasetGalleryPage
              dataset={dataset}
              project={project}
              datasetId={dataset.id}
              projectId={project.id}
            />
          )}

          {activeTab === "versions" && (
            <VersionsPage
              dataset={dataset}
              project={project}
              datasetId={dataset.id}
              projectId={project.id}
            />
          )}

          {activeTab === "classes" && (
            <ClassesTagsPage
              dataset={dataset}
              project={project}
              datasetId={dataset.id}
              projectId={project.id}
            />
          )}
        </div>
      </div>
    </div>
  );
}
