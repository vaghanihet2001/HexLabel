// frontend/src/pages/DatasetPage.jsx
import React, { useState, useEffect } from "react";
import { Tabs, Tab, Button } from "react-bootstrap";
import { useParams, useNavigate } from "react-router-dom";
import { useTheme } from "../components/ThemeContext";
import UploadImagesPage from "./dataset/UploadImagesPage";
import AnnotationTasksPage from "./dataset/AnnotationTasksPage";
import DatasetGalleryPage from "./dataset/DatasetGalleryPage";
import VersionsPage from "./dataset/VersionsPage";
import AnalyticsPage from "./dataset/AnalyticsPage";
import ClassesTagsPage from "./dataset/ClassesTagsPage";
import { db } from "../utils/db";

export default function DatasetPage() {
  const { projectId, datasetId } = useParams();
  const navigate = useNavigate();
  const { themeColors } = useTheme();

  const [activeTab, setActiveTab] = useState("upload");
  const [jobRefresh, setJobRefresh] = useState(0);
  const [dataset, setDataset] = useState(null);

  // ✅ Load dataset info safely
  useEffect(() => {
    const loadDataset = async () => {
      try {
        const ds = await db.datasets.get(datasetId);
        setDataset(ds);
        console.log("📦 Loaded dataset:", datasetId, ds);
      } catch (err) {
        console.error("❌ Failed to load dataset:", err);
      }
    };
    loadDataset();
  }, [datasetId]);

  const handleJobCreated = () => {
    setActiveTab("tasks");
    setJobRefresh((prev) => prev + 1);
  };

  return (
    <div
      className="p-4"
      style={{
        backgroundColor: themeColors.background,
        color: themeColors.text,
        height: "calc(100vh - 60px)",
        transition: "background-color 0.3s ease",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      {/* 🔙 Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
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
            Dataset: {dataset?.name || datasetId}
          </h3>
        </div>
      </div>

      {/* 🧩 Tabs */}
      <Tabs
        activeKey={activeTab}
        onSelect={(k) => setActiveTab(k)}
        className="mb-4"
        justify
        style={{
          height: "60px",
          background: themeColors.cardBg,
          borderRadius: 8,
          padding: "0.5rem",
          borderColor: themeColors.border,
        }}
      >
        <Tab eventKey="upload" title="📤 Upload Images">
          <UploadImagesPage datasetId={datasetId} onJobCreated={handleJobCreated} />
        </Tab>
        <Tab eventKey="tasks" title="🧩 Annotation Tasks">
          <AnnotationTasksPage datasetId={datasetId} jobRefresh={jobRefresh} />
        </Tab>
        <Tab eventKey="dataset" title="🖼 Dataset">
          <DatasetGalleryPage datasetId={datasetId} />
        </Tab>
        <Tab eventKey="versions" title="📦 Versions">
          <VersionsPage datasetId={datasetId} />
        </Tab>
        <Tab eventKey="analytics" title="📊 Analytics">
          <AnalyticsPage datasetId={datasetId} />
        </Tab>
        <Tab eventKey="classes" title="🏷 Classes & Tags">
          <ClassesTagsPage datasetId={datasetId} />
        </Tab>
      </Tabs>
    </div>
  );
}
