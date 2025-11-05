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
import { db, generateId } from "../utils/db";

export default function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { themeColors } = useTheme();

  const [project, setProject] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [hasPermission, setHasPermission] = useState(true);

  // delete modal states
  const [showDelete, setShowDelete] = useState(false);
  const [datasetToDelete, setDatasetToDelete] = useState(null);

  /** 🔄 Load project and datasets */
  useEffect(() => {
    const load = async () => {
      const proj = await db.projects.get(projectId);
      if (!proj) {
        setProject(null);
        return;
      }
      setProject(proj);

      const sets = await db.datasets.where("projectId").equals(projectId).toArray();
      setDatasets(sets);

      // Check folder permission
      if (proj.folderHandle) {
        try {
          const state = await proj.folderHandle.queryPermission({
            mode: "readwrite",
          });
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

  /** 🔐 Request folder permission again */
  const handleGrantPermission = async () => {
    if (!project?.folderHandle) {
      alert("Project folder not available. Re-select project folder in Projects page.");
      return;
    }
    try {
      const perm = await project.folderHandle.requestPermission({
        mode: "readwrite",
      });
      setHasPermission(perm === "granted");
      if (perm !== "granted") alert("Permission not granted.");
    } catch (err) {
      console.error(err);
      alert("Permission request failed.");
      setHasPermission(false);
    }
  };

  /** ➕ Add Dataset */
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

    let state = await project.folderHandle.queryPermission({ mode: "readwrite" });
    if (state !== "granted")
      state = await project.folderHandle.requestPermission({ mode: "readwrite" });
    if (state !== "granted") {
      alert("Write permission required. Click 'Grant Folder Access' first.");
      setHasPermission(false);
      return;
    }

    try {
      const datasetId = generateId(); // 🆕 string-based unique ID
      const dsFolder = await project.folderHandle.getDirectoryHandle(newDatasetName, {
        create: true,
      });

      await db.datasets.add({
        id: datasetId,
        name: newDatasetName,
        projectId: projectId,
        folderHandle: dsFolder,
        createdAt: new Date().toISOString(),
      });

      const updated = await db.datasets.where("projectId").equals(projectId).toArray();
      setDatasets(updated);
      setShowAdd(false);
      setNewDatasetName("");
    } catch (err) {
      console.error("Failed to create dataset:", err);
      alert("Failed to create dataset. Please check folder permissions and try again.");
    }
  };

  /** 🧹 Delete ALL data related to a dataset */
  const handleConfirmDeleteDataset = async () => {
    if (!datasetToDelete) return;
    try {
      const datasetId = datasetToDelete.id;

      // 1️⃣ Delete dataset folder from file system
      if (project?.folderHandle) {
        try {
          await project.folderHandle.removeEntry(datasetToDelete.name, {
            recursive: true,
          });
          console.log("✅ Deleted folder:", datasetToDelete.name);
        } catch (err) {
          console.warn("⚠️ Could not delete dataset folder:", err);
        }
      }

      // 2️⃣ Delete all related entries in Dexie
      await Promise.all([
        db.images.where("datasetId").equals(datasetId).delete(),
        db.jobs.where("datasetId").equals(datasetId).delete(),
        db.annotations.where("datasetId").equals(datasetId).delete(),
        db.tempImages.where("datasetId").equals(datasetId).delete(),
        db.datasetVersions.where("datasetId").equals(datasetId).delete(),
        db.datasets.delete(datasetId),
      ]);

      console.log(`🧽 Deleted dataset ${datasetId} and all related records`);

      // 3️⃣ Refresh dataset list
      const updated = await db.datasets.where("projectId").equals(projectId).toArray();
      setDatasets(updated);

      setShowDelete(false);
      setDatasetToDelete(null);
    } catch (err) {
      console.error("❌ Failed to delete dataset:", err);
      alert("Failed to delete dataset and related data.");
    }
  };

  const openDeleteModal = (ds) => {
    setDatasetToDelete(ds);
    setShowDelete(true);
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
    <div
      className="p-4"
      style={{
        backgroundColor: themeColors.background,
        color: themeColors.text,
      }}
    >
      {/* HEADER */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-center">
          <Button
            variant="outline-secondary"
            className="me-3"
            onClick={() => navigate("/projects")}
          >
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

      <p style={{ color: themeColors.subtleText }} className="mb-4">
        {project.description}
      </p>

      {/* DATASET GRID */}
      {datasets.length === 0 ? (
        <p style={{ opacity: 0.7, color: themeColors.subtleText }}>
          No datasets yet.
        </p>
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
                  <p className="mb-2 small" style={{ color: themeColors.subtleText }}>
                    {new Date(ds.createdAt).toLocaleString()}
                  </p>

                  <div className="d-flex justify-content-between">
                    <OverlayTrigger placement="top" overlay={<Tooltip>Open</Tooltip>}>
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() =>
                          navigate(`/project/${projectId}/dataset/${ds.id}`)
                        }
                      >
                        <Database size={14} />
                      </Button>
                    </OverlayTrigger>

                    <OverlayTrigger placement="top" overlay={<Tooltip>Delete</Tooltip>}>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => openDeleteModal(ds)}
                      >
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

      {/* ➕ Add Dataset Modal */}
      <Modal show={showAdd} onHide={() => setShowAdd(false)} centered>
        <Modal.Header
          closeButton
          style={{ backgroundColor: themeColors.cardBg, color: themeColors.text }}
        >
          <Modal.Title>Add Dataset</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ backgroundColor: themeColors.background }}>
          <Form onSubmit={handleAddDataset}>
            <Form.Group className="mb-3">
              <Form.Label style={{ color: themeColors.text }}>Dataset Name</Form.Label>
              <Form.Control
                type="text"
                value={newDatasetName}
                onChange={(e) => setNewDatasetName(e.target.value)}
                required
                style={{
                  backgroundColor: themeColors.inputBg,
                  color: themeColors.inputText,
                  border: `1px solid ${themeColors.border}`,
                }}
              />
            </Form.Group>

            <div className="d-flex justify-content-end">
              <Button variant="secondary" className="me-2" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                Save Dataset
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      {/* 🗑️ Delete Confirmation Modal */}
      <Modal show={showDelete} onHide={() => setShowDelete(false)} centered>
        <Modal.Header
          closeButton
          style={{ backgroundColor: themeColors.cardBg, color: themeColors.text }}
        >
          <Modal.Title>Confirm Deletion</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ backgroundColor: themeColors.cardBg, color: themeColors.text }}>
          Are you sure you want to delete the dataset{" "}
          <strong>{datasetToDelete?.name}</strong>?<br />
          This will permanently remove its folder and all related records.
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: themeColors.cardBg }}>
          <Button variant="secondary" onClick={() => setShowDelete(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirmDeleteDataset}>
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
