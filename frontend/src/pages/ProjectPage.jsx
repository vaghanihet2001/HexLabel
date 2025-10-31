// src/pages/ProjectPage.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Card,
  Button,
  Row,
  Col,
  OverlayTrigger,
  Tooltip,
  Modal,
  Form,
} from "react-bootstrap";
import { Database, FolderOpen, Plus, Trash2, Lock } from "lucide-react";
import { useTheme } from "../components/ThemeContext";
import { db } from "../utils/db";

export default function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { themeColors } = useTheme();

  const [project, setProject] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [hasPermission, setHasPermission] = useState(true);

  useEffect(() => {
    const load = async () => {
      const proj = await db.projects.get(Number(projectId));
      if (!proj) {
        setProject(null);
        return;
      }
      setProject(proj);

      // ensure datasets store exists
      try {
        db.version(2).stores({
          projects: "++id, name, description, datasets, models, folderHandle",
          datasets: "++id, name, projectId, folderHandle, createdAt",
        });
      } catch {}

      const sets = await db.datasets.where("projectId").equals(Number(projectId)).toArray();
      setDatasets(sets);

      // check permission
      if (proj.folderHandle) {
        try {
          const state = await proj.folderHandle.queryPermission({ mode: "readwrite" });
          setHasPermission(state === "granted");
        } catch {
          setHasPermission(false);
        }
      } else {
        setHasPermission(false);
      }
    };
    load();
  }, [projectId]);

  const handleGrantPermission = async () => {
    if (!project?.folderHandle) {
      alert("Project folder not available. Re-select project folder in Projects page.");
      return;
    }
    try {
      const perm = await project.folderHandle.requestPermission({ mode: "readwrite" });
      setHasPermission(perm === "granted");
      if (perm !== "granted") alert("Permission not granted.");
    } catch (err) {
      console.error(err);
      alert("Permission request failed.");
      setHasPermission(false);
    }
  };

  const handleAddDataset = async (e) => {
    e.preventDefault();
    if (!newDatasetName.trim()) {
      alert("Please enter a dataset name.");
      return;
    }
    if (!project?.folderHandle) {
      alert("Project folder missing. Recreate project or reselect folder.");
      return;
    }

    // Ensure write permission
    let state = await project.folderHandle.queryPermission({ mode: "readwrite" });
    if (state !== "granted") {
      state = await project.folderHandle.requestPermission({ mode: "readwrite" });
    }
    if (state !== "granted") {
      alert("Write permission required. Click 'Grant Folder Access' first.");
      setHasPermission(false);
      return;
    }

    try {
      // create dataset folder inside project folder
      const dsFolder = await project.folderHandle.getDirectoryHandle(newDatasetName, { create: true });

      // store dataset metadata (Dexie can clone the handle)
      await db.datasets.add({
        name: newDatasetName,
        projectId: Number(projectId),
        folderHandle: dsFolder,
        createdAt: new Date().toLocaleString(),
      });

      const updated = await db.datasets.where("projectId").equals(Number(projectId)).toArray();
      setDatasets(updated);
      setShowAdd(false);
      setNewDatasetName("");
    } catch (err) {
      console.error("Failed to create dataset:", err);
      alert("Failed to create dataset. Please check folder permissions and try again.");
    }
  };

  const handleDeleteDataset = async (id) => {
    await db.datasets.delete(id);
    const updated = await db.datasets.where("projectId").equals(Number(projectId)).toArray();
    setDatasets(updated);
  };

  if (!project)
    return (
      <div className="p-4" style={{ color: themeColors.text }}>
        Project not found or loading...
      </div>
    );

  const cardStyle = {
    backgroundColor: themeColors.cardBg,
    color: themeColors.text,
    border: `1px solid ${themeColors.border}`,
    borderRadius: "12px",
  };

  const placeholderStyle = {
    width: "100%",
    height: "140px",
    borderRadius: "10px",
    backgroundColor: themeColors.toolbarBg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: themeColors.placeholderText,
    fontSize: "0.9rem",
  };

  return (
    <div className="p-4" style={{ backgroundColor: themeColors.background, color: themeColors.text }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-center">
          <Button variant="outline-secondary" className="me-3" onClick={() => navigate("/projects")}>
            ← Back
          </Button>
          <h2 className="fw-semibold mb-0">{project.name}</h2>
        </div>

        {hasPermission ? (
          <Button variant="primary" onClick={() => setShowAdd(true)}>
            <Plus size={16} className="me-1" /> Add Dataset
          </Button>
        ) : (
          <Button variant="warning" onClick={handleGrantPermission}>
            <Lock size={14} className="me-1" /> Grant Folder Access
          </Button>
        )}
      </div>

      <p className="text-muted mb-4">{project.description}</p>

      {datasets.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No datasets yet.</p>
      ) : (
        <Row xs={1} sm={2} md={3} lg={4} className="g-4">
          {datasets.map((ds) => (
            <Col key={ds.id}>
              <Card style={cardStyle} className="p-2 h-100">
                <div style={placeholderStyle}>
                  <FolderOpen size={20} />
                </div>
                <Card.Body className="pt-2">
                  <h5 className="mb-1">{ds.name}</h5>
                  <p className="text-muted mb-2 small">{ds.createdAt}</p>

                  <div className="d-flex justify-content-between">
                    <OverlayTrigger placement="top" overlay={<Tooltip>Open</Tooltip>}>
                      <Button variant="outline-primary" size="sm" onClick={() => console.log("Open dataset", ds.name)}>
                        <Database size={14} />
                      </Button>
                    </OverlayTrigger>

                    <OverlayTrigger placement="top" overlay={<Tooltip>Delete</Tooltip>}>
                      <Button variant="outline-danger" size="sm" onClick={() => handleDeleteDataset(ds.id)}>
                        <Trash2 size={14} />
                      </Button>
                    </OverlayTrigger>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal show={showAdd} onHide={() => setShowAdd(false)} centered>
        <Modal.Header closeButton style={{ backgroundColor: themeColors.cardBg }}>
          <Modal.Title>Add Dataset</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ backgroundColor: themeColors.background }}>
          <Form onSubmit={handleAddDataset}>
            <Form.Group className="mb-3">
              <Form.Label>Dataset Name</Form.Label>
              <Form.Control type="text" value={newDatasetName} onChange={(e) => setNewDatasetName(e.target.value)} required />
            </Form.Group>

            <div className="d-flex justify-content-end">
              <Button variant="secondary" className="me-2" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button variant="primary" type="submit">Save Dataset</Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </div>
  );
}
