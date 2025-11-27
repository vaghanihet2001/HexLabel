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
        const projects = await db.projects.count();
        const datasets = await db.datasets.count();
        const images = await db.images.count();
        const annotations = await db.annotations.count();
        const jobs = await db.jobs.count();

        // Storage estimation (IndexedDB blobs aren't easy to size)
        // → so approximate by number of images × 1.5MB avg
        const estimatedBytes = images * 1.5 * 1024 * 1024;
        const storageUsed =
          (estimatedBytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
        const storagePercent = Math.min(
          Math.round((estimatedBytes / (5 * 1024 * 1024 * 1024)) * 100),
          100
        ); // assume 5GB local limit

        // Build category stats by reading annotation types
        const annotationRows = await db.annotations.toArray();
        const categoriesCount = {
          Detection: 0,
          Segmentation: 0,
          Classification: 0,
          Keypoints: 0,
        };

        annotationRows.forEach((a) => {
          const type = a?.data?.type;
          if (type && categoriesCount[type] !== undefined) {
            categoriesCount[type]++;
          }
        });

        const categories = Object.keys(categoriesCount).map((key) => ({
          name: key,
          count: categoriesCount[key],
        }));

        // No activity table in schema → generate fallback from timestamps
        const recentActivity = [
          {
            id: 1,
            text: `You have ${projects} project(s)`,
            time: "now",
          },
          {
            id: 2,
            text: `${datasets} datasets present`,
            time: "now",
          },
          {
            id: 3,
            text: `${images} images imported`,
            time: "now",
          },
          {
            id: 4,
            text: `${annotations} annotations created`,
            time: "now",
          },
        ];

        setStats({
          projects,
          datasets,
          images,
          jobs,
          annotations,
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
      <Row xs={1} sm={2} md={3} className="g-4 mt-2">
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
          <Card style={cardStyle} className="p-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="d-flex align-items-center">
                <HardDrive size={28} className="me-2" color={themeColors.text} />
                <div>
                  <h6 className="mb-0">Storage</h6>
                  <small>{stats.storageUsed} estimated</small>
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
