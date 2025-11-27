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
  Form,
} from "react-bootstrap";
import { Database, FolderOpen, Plus, Trash2, Lock } from "lucide-react";
import { useTheme } from "../components/ThemeContext";
import AppModal from "../components/AppModal";
import { db, generateId } from "../utils/db";
import * as fsUtils from "../utils/fs";

export default function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { themeColors } = useTheme();

  const [project, setProject] = useState(null);
  const [datasets, setDatasets] = useState([]);

  // modal state for global app modal
  const [modal, setModal] = useState({
    show: false,
    type: "info",
    title: "",
    message: "",
    confirmText: "OK",
    cancelText: "Cancel",
    onConfirm: null,
    autoClose: false,
  });

  const openModal = (data) =>
    setModal({
      show: true,
      type: data.type || "info",
      title: data.title || "",
      message: data.message || "",
      confirmText: data.confirmText || "OK",
      cancelText: data.cancelText || "Cancel",
      onConfirm: data.onConfirm || null,
      autoClose: data.autoClose || false,
    });

  const closeModal = () => setModal((prev) => ({ ...prev, show: false, onConfirm: null }));

  const [showAdd, setShowAdd] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [newDatasetType, setNewDatasetType] = useState("detect");
  const [newDatasetDescription, setNewDatasetDescription] = useState("");
  const [hasPermission, setHasPermission] = useState(true);

  // load project and datasets (from DB or disk)
  useEffect(() => {
    const load = async () => {
      const proj = await db.projects.get(projectId);
      if (!proj) {
        setProject(null);
        return;
      }
      setProject(proj);

      // try to sync from disk (if folderHandle present)
      if (proj.folderHandle) {
        try {
          await fsUtils.syncProjectToIndexedDB(proj.folderHandle, true);
          const sets = await db.datasets.where("projectId").equals(projectId).toArray();
          setDatasets(sets);
        } catch (err) {
          // fallback to DB datasets
          const sets = await db.datasets.where("projectId").equals(projectId).toArray();
          setDatasets(sets);
        }

        try {
          const state = await proj.folderHandle.queryPermission({ mode: "readwrite" });
          setHasPermission(state === "granted");
        } catch {
          setHasPermission(false);
        }
      } else {
        const sets = await db.datasets.where("projectId").equals(projectId).toArray();
        setDatasets(sets);
        setHasPermission(false);
      }
    };
    load();
  }, [projectId]);

  // request permission
  const handleGrantPermission = async () => {
    if (!project?.folderHandle) {
      return openModal({
        type: "error",
        title: "Missing Folder",
        message: "Project folder not found. Re-select project in Projects page.",
      });
    }
    try {
      const perm = await project.folderHandle.requestPermission({ mode: "readwrite" });
      setHasPermission(perm === "granted");
      if (perm !== "granted") openModal({ type: "error", title: "Permission Denied", message: "Write permission not granted." });
    } catch (err) {
      openModal({ type: "error", title: "Permission Error", message: "Failed to request permission." });
    }
  };

  // add dataset
  const handleAddDataset = async () => {
    if (!newDatasetName.trim()) {
      return openModal({
        type: "error",
        title: "Name Required",
        message: "Enter a dataset name."
      });
    }

    if (!project?.folderHandle) {
      return openModal({
        type: "error",
        title: "Missing Folder",
        message: "Project folder missing."
      });
    }

    let perm = await project.folderHandle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted")
      perm = await project.folderHandle.requestPermission({ mode: "readwrite" });

    if (perm !== "granted") {
      setHasPermission(false);
      return openModal({
        type: "error",
        title: "Permission Required",
        message: "Write permission required to create dataset."
      });
    }

    try {
      const datasetId = generateId();
      const datasetMeta = {
        id: datasetId,
        name: newDatasetName,
        description: newDatasetDescription || "",
        type: newDatasetType || "detect",
        projectId: projectId,
        createdAt: new Date().toISOString(),
        imageCount: 0,
        annotationVersions: [],
      };

      // create folders
      await fsUtils.createDatasetFolderStructure(project.folderHandle, datasetMeta);

      // update project metadata
      await fsUtils.addDatasetToProjectMeta(project.folderHandle, {
        id: datasetMeta.id,
        name: datasetMeta.name,
        description: datasetMeta.description,
        type: datasetMeta.type,
        createdAt: datasetMeta.createdAt,
        imageCount: 0,
      });

      // add to IndexedDB
      await db.datasets.add({
        ...datasetMeta,
        folderHandle: await project.folderHandle.getDirectoryHandle(newDatasetName),
      });

      const updated = await db.datasets.where("projectId").equals(projectId).toArray();
      setDatasets(updated);

      openModal({
        type: "success",
        title: "Dataset Created",
        message: `"${newDatasetName}" created successfully.`,
        autoClose: true
      });

      setShowAdd(false);
      setNewDatasetName("");
      setNewDatasetDescription("");
      setNewDatasetType("detect");

    } catch (err) {
      console.error("Failed to create dataset:", err);
      openModal({
        type: "error",
        title: "Failed",
        message: "Could not create dataset. Check permissions."
      });
    }
  };

  // delete dataset
  const openDeleteDatasetModal = (dataset) => {
    openModal({
      type: "confirm",
      title: "Delete Dataset?",
      message: `Delete "${dataset.name}" and all its data?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        try {
          // delete dataset folder
          if (project.folderHandle) {
            try {
              await project.folderHandle.removeEntry(dataset.name, { recursive: true });
            } catch (err) {
              // ignore
            }
          }

          // delete DB entries
          await Promise.all([
            db.images.where("datasetId").equals(dataset.id).delete(),
            db.tempImages.where("datasetId").equals(dataset.id).delete(),
            db.annotations.where("datasetId").equals(dataset.id).delete(),
            db.jobs.where("datasetId").equals(dataset.id).delete(),
            db.datasetVersions.where("datasetId").equals(dataset.id).delete(),
            db.datasets.delete(dataset.id),
          ]);

          // update project.json
          try {
            await fsUtils.removeDatasetFromProjectMeta(project.folderHandle, dataset.id);
          } catch (err) {
            // ignore
          }

          // refresh UI
          const updated = await db.datasets.where("projectId").equals(projectId).toArray();
          setDatasets(updated);
          return true;
        } catch (err) {
          openModal({ type: "error", title: "Delete Failed", message: "Could not delete dataset." });
          return false;
        }
      },
      autoClose: true,
    });
  };

  if (!project) return <div className="p-4" style={{ color: themeColors.text }}>Project not found.</div>;

  return (
    <div className="p-4">
      {/* Global AppModal */}
      <AppModal {...modal} show={modal.show} onClose={closeModal} />

      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-center">
          <Button variant="outline-secondary" className="me-3" onClick={() => navigate("/projects")}>← Back</Button>
          <h2 className="fw-semibold mb-0">{project.name}</h2>
        </div>

        {hasPermission ? (
          <Button variant="primary" onClick={() => setShowAdd(true)}><Plus size={16} className="me-1" /> Add Dataset</Button>
        ) : (
          <Button variant="warning" onClick={handleGrantPermission}><Lock size={16} className="me-1" /> Grant Folder Access</Button>
        )}
      </div>

      <p style={{ color: themeColors.subtleText }}>{project.description}</p>

      {/* dataset grid */}
      {datasets.length === 0 ? (
        <p style={{ color: themeColors.subtleText }}>No datasets found.</p>
      ) : (
        <Row xs={1} sm={2} md={3} lg={4} className="g-4">
          {datasets.map((ds) => (
            <Col key={ds.id}>
              <Card className="p-2 h-100" style={{ backgroundColor: themeColors.cardBg, color: themeColors.text }}>
                <div className="d-flex align-items-center justify-content-center" style={{ height: 140, background: themeColors.toolbarBg, borderRadius: 10 }}>
                  <FolderOpen size={20} />
                </div>

                <Card.Body>
                  <h5 className="mb-1">{ds.name}</h5>
                  <p className="small" style={{ color: themeColors.subtleText }}>{ds.type || "detect"}</p>
                  <p className="small" style={{ color: themeColors.subtleText }}>{ds.createdAt ? new Date(ds.createdAt).toLocaleString() : ""}</p>

                  <div className="d-flex justify-content-between">
                    <Button size="sm" variant="outline-primary" onClick={() => navigate(`/project/${projectId}/dataset/${ds.id}`)}><Database size={14} /></Button>
                    <Button size="sm" variant="outline-danger" onClick={() => openDeleteDatasetModal(ds)}><Trash2 size={14} /></Button>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* Add dataset modal (uses AppModal for confirm; we use showAdd state to toggle) */}
      {showAdd && (
        <AppModal
          show={showAdd}
          onClose={() => setShowAdd(false)}
          title="Create Dataset"
          type="confirm"
          confirmText="Create"
          cancelText="Cancel"
          onConfirm={handleAddDataset}
          autoClose={false}
          message={
            // we pass a small HTML string or React fragment — AppModal renders message directly so it'll accept JSX
            <div>
              <Form.Group className="mb-2">
                <Form.Label>Name</Form.Label>
                <Form.Control value={newDatasetName} onChange={(e) => setNewDatasetName(e.target.value)} />
              </Form.Group>

              <Form.Group className="mb-2">
                <Form.Label>Description</Form.Label>
                <Form.Control as="textarea" rows={2} value={newDatasetDescription} onChange={(e) => setNewDatasetDescription(e.target.value)} />
              </Form.Group>

              <Form.Group>
                <Form.Label>Type</Form.Label>
                <Form.Select value={newDatasetType} onChange={(e) => setNewDatasetType(e.target.value)}>
                  <option value="detect">Detection</option>
                  <option value="segment">Segmentation</option>
                  <option value="obb">OBB</option>
                  <option value="classify">Classification</option>
                  <option value="ocr">OCR</option>
                </Form.Select>
              </Form.Group>
            </div>
          }
        />
      )}
    </div>
  );
}
