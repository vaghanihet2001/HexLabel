// frontend/src/pages/Dashboard.jsx
import React from "react";
import { Card, Row, Col, ProgressBar, ListGroup } from "react-bootstrap";
import { useTheme } from "../components/ThemeContext";
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

  // --- Demo stats (replace with real data later) ---
  const stats = {
    projects: 8,
    datasets: 12,
    storageUsed: "4.8 GB",
    storagePercent: 48,
    categories: [
      { name: "Detection", icon: <Image size={16} />, count: 5 },
      { name: "Segmentation", icon: <PenTool size={16} />, count: 3 },
      { name: "Classification", icon: <Tag size={16} />, count: 2 },
      { name: "Keypoints", icon: <MousePointer2 size={16} />, count: 1 },
    ],
    recentActivity: [
      {
        id: 1,
        text: "Annotated 120 new objects in 'CityScenes' dataset.",
        time: "2 hours ago",
      },
      {
        id: 2,
        text: "Created new project 'Vehicle Detection v2'.",
        time: "1 day ago",
      },
      {
        id: 3,
        text: "Uploaded dataset 'People Segmentation'.",
        time: "2 days ago",
      },
      {
        id: 4,
        text: "Exported annotations to COCO format.",
        time: "3 days ago",
      },
    ],
  };

  // --- Theme styles ---
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
      {/* Header */}
      <h2 className="fw-semibold mb-3">Dashboard</h2>
      <p style={{ opacity: 0.8 }}>Overview of your annotation workspace</p>

      {/* Summary cards */}
      <Row xs={1} sm={2} md={3} className="g-4 mt-2">
        <Col>
          <Card style={cardStyle} className="p-3 d-flex flex-row align-items-center">
            <Folder size={36} className="me-3" color={themeColors.text} />
            <div>
              <h5 className="mb-1">{stats.projects}</h5>
              <small>Projects</small>
            </div>
          </Card>
        </Col>
        <Col>
          <Card style={cardStyle} className="p-3 d-flex flex-row align-items-center">
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
                  <small>{stats.storageUsed} used</small>
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
                  {cat.icon}
                  <span className="ms-2">{cat.name}</span>
                </div>
                <span className="badge bg-secondary">{cat.count}</span>
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      {/* Activity feed */}
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
