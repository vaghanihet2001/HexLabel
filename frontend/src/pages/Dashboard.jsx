// frontend/src/pages/Dashboard.jsx
import React, { useEffect, useState } from "react";
import { Card, Row, Col, ProgressBar, ListGroup } from "react-bootstrap";
import { useTheme } from "../components/ThemeContext";
import db from "/src/utils/db";

import {
  Folder,
  Database,
  HardDrive,
  Activity,
  Image,
  PenTool,
  Tag,
  MousePointer2,
} from "lucide-react";

export default function Dashboard() {
  const { themeColors } = useTheme();
  const [stats, setStats] = useState(null);

  // Icons mapping
  const categoryIcons = {
    Detection: <Image size={16} />,
    Segmentation: <PenTool size={16} />,
    Classification: <Tag size={16} />,
    Keypoints: <MousePointer2 size={16} />,
  };

  // Load dashboard stats from IndexedDB
  useEffect(() => {
    async function loadStats() {
      try {
        const projectsCount = await db.projects.count();
        const datasets = await db.datasets.toArray();
        const imagesCount = await db.images.count();
        const annotationsCount = await db.annotations.count();
        const versionsCount = await db.datasetVersions.count();

        // 1. Build category stats by looking at Dataset types (much faster and more reliable)
        const categoriesCount = {
          Detection: 0,
          Segmentation: 0,
          Classification: 0,
          Keypoints: 0,
        };

        datasets.forEach(ds => {
          let label = "";
          if (ds.type === "detect") label = "Detection";
          else if (ds.type === "segment") label = "Segmentation";
          else if (ds.type === "classify") label = "Classification";
          else if (ds.type === "keypoint") label = "Keypoints";

          if (label && categoriesCount[label] !== undefined) {
             // For simplicity, we count datasets of this type, 
             // or we could count images within these datasets for more precision.
             categoriesCount[label]++;
          }
        });

        const categories = Object.keys(categoriesCount).map((key) => ({
          name: key,
          count: categoriesCount[key],
        }));

        // 2. Real Storage Tracking (using Browser API)
        let storageUsed = "0 GB";
        let storagePercent = 0;
        
        if (navigator.storage && navigator.storage.estimate) {
          const estimate = await navigator.storage.estimate();
          // estimate.usage is in bytes
          const usedGB = (estimate.usage / (1024 * 1024 * 1024)).toFixed(2);
          const quotaGB = (estimate.quota / (1024 * 1024 * 1024)).toFixed(1);
          storageUsed = `${usedGB} / ${quotaGB} GB`;
          storagePercent = Math.min(Math.round((estimate.usage / estimate.quota) * 100), 100);
        } else {
          // Fallback heuristic if API unavailable
          const estimatedBytes = imagesCount * 1.5 * 1024 * 1024;
          storageUsed = (estimatedBytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
          storagePercent = Math.min(Math.round((estimatedBytes / (5 * 1024 * 1024 * 1024)) * 100), 100);
        }

        // 3. Activity
        const recentActivity = [
          { id: 1, text: `Active Projects: ${projectsCount}`, time: "Live" },
          { id: 2, text: `Snapshot Versions: ${versionsCount}`, time: "Live" },
          { id: 3, text: `Total Active Images: ${imagesCount}`, time: "Live" },
          { id: 4, text: `Total Active Annotations: ${annotationsCount}`, time: "Live" },
        ];

        setStats({
          projects: projectsCount,
          datasets: datasets.length,
          images: imagesCount,
          annotations: annotationsCount,
          versions: versionsCount,
          storageUsed,
          storagePercent,
          categories,
          recentActivity,
        });
      } catch (err) {
        console.error("Dashboard DB error:", err);
      }
    }

    loadStats();
  }, []);

  if (!stats) {
    return (
      <div className="p-4" style={{ color: themeColors.text }}>
        <h4>Loading dashboard...</h4>
      </div>
    );
  }

  // UI card style
  const cardStyle = {
    backgroundColor: themeColors.cardBg,
    color: themeColors.text,
    border: `1px solid ${themeColors.border}`,
    borderRadius: "12px",
    boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
  };

  return (
    <div
      className="p-4"
      style={{
        backgroundColor: themeColors.background,
        color: themeColors.text,
        minHeight: "100%",
      }}
    >
      <h2 className="fw-semibold mb-3">Dashboard</h2>
      <p style={{ opacity: 0.8 }}>Overview of your annotation workspace</p>

      {/* Summary cards */}
      <Row xs={1} sm={2} md={4} className="g-4 mt-2">
        <Col>
          <Card
            style={cardStyle}
            className="p-3 d-flex flex-row align-items-center"
          >
            <Folder size={36} className="me-3" color={themeColors.text} />
            <div>
              <h5 className="mb-1">{stats.projects}</h5>
              <small>Projects</small>
            </div>
          </Card>
        </Col>

        <Col>
          <Card
            style={cardStyle}
            className="p-3 d-flex flex-row align-items-center"
          >
            <Database size={36} className="me-3" color={themeColors.text} />
            <div>
              <h5 className="mb-1">{stats.datasets}</h5>
              <small>Datasets</small>
            </div>
          </Card>
        </Col>

        <Col>
          <Card
            style={cardStyle}
            className="p-3 d-flex flex-row align-items-center"
          >
            <Activity size={36} className="me-3" color={themeColors.text} />
            <div>
              <h5 className="mb-1">{stats.versions}</h5>
              <small>Versions</small>
            </div>
          </Card>
        </Col>

        <Col>
          <Card style={cardStyle} className="p-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="d-flex align-items-center">
                <HardDrive size={28} className="me-2" color={themeColors.text} />
                <div>
                  <h6 className="mb-0">Browser Storage</h6>
                  <small>{stats.storageUsed}</small>
                </div>
              </div>
              <span>{stats.storagePercent}%</span>
            </div>
            <ProgressBar
              now={stats.storagePercent}
              variant="info"
              style={{ height: "6px", borderRadius: "5px" }}
            />
          </Card>
        </Col>
      </Row>

      {/* Category stats */}
      <Card style={{ ...cardStyle, marginTop: "2rem" }} className="p-3">
        <h5 className="mb-3">Annotation Categories</h5>
        <Row xs={2} sm={2} md={4} className="g-3">
          {stats.categories.map((cat) => (
            <Col key={cat.name}>
              <div
                style={{
                  backgroundColor: themeColors.toolbarBg,
                  borderRadius: "10px",
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  border: `1px solid ${themeColors.border}`,
                }}
              >
                <div className="d-flex align-items-center">
                  {categoryIcons[cat.name]}
                  <span className="ms-2">{cat.name}</span>
                </div>
                <span className="badge bg-secondary">{cat.count}</span>
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      {/* Activity */}
      <Card style={{ ...cardStyle, marginTop: "2rem" }} className="p-3">
        <div className="d-flex align-items-center mb-2">
          <Activity size={20} className="me-2" color={themeColors.text} />
          <h5 className="mb-0">Recent Activity</h5>
        </div>
        <ListGroup variant="flush">
          {stats.recentActivity.map((activity) => (
            <ListGroup.Item
              key={activity.id}
              style={{
                backgroundColor: themeColors.cardBg,
                color: themeColors.text,
                borderBottom: `1px solid ${themeColors.border}`,
              }}
            >
              <div className="d-flex justify-content-between align-items-center">
                <span>{activity.text}</span>
                <small style={{ opacity: 0.7 }}>{activity.time}</small>
              </div>
            </ListGroup.Item>
          ))}
        </ListGroup>
      </Card>
    </div>
  );
}
