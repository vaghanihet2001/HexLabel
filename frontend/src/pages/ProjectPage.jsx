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
import { Database, FolderOpen, Plus, Trash2, Lock, Edit } from "lucide-react";
import { useTheme } from "../components/ThemeContext";
import { resizeImageFile } from "../utils/imageUtils";
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
  const [editDatasetId, setEditDatasetId] = useState(null);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [newDatasetType, setNewDatasetType] = useState("detect");
  const [newDatasetDescription, setNewDatasetDescription] = useState("");
  const [newDatasetCover, setNewDatasetCover] = useState(null);
  const [hasPermission, setHasPermission] = useState(true);

  // Helper to fetch datasets and inject fallback images
  const fetchDatasetsWithImages = async (pid) => {
    const sets = await db.datasets.where("projectId").equals(pid).toArray();
    return await Promise.all(
      sets.map(async (ds) => {
        let defaultImage = ds.coverImage;
        if (!defaultImage) {
          const firstImg = await db.images.where("datasetId").equals(ds.id).first();
          if (firstImg) {
            if (firstImg.url && !firstImg.url.startsWith("blob:")) {
              defaultImage = firstImg.url;
            } else if (ds.folderHandle) {
              try {
                const imagesDir = await ds.folderHandle.getDirectoryHandle("images");
                const rawDir = await imagesDir.getDirectoryHandle("raw");
                const fh = await rawDir.getFileHandle(firstImg.name);
                const file = await fh.getFile();
                defaultImage = URL.createObjectURL(file);
              } catch (e) {}
            }
          }
        }
        return { ...ds, defaultImage };
      })
    );
  };

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
        } catch (err) {}

        try {
          const state = await proj.folderHandle.queryPermission({ mode: "readwrite" });
          setHasPermission(state === "granted");
        } catch {
          setHasPermission(false);
        }
      } else {
        setHasPermission(false);
      }

      setDatasets(await fetchDatasetsWithImages(projectId));
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

  // open add modal
  const openAddModal = () => {
    setEditDatasetId(null);
    setNewDatasetName("");
    setNewDatasetType("detect");
    setNewDatasetDescription("");
    setNewDatasetCover(null);
    setShowAdd(true);
  };

  // open edit modal
  const openEditModal = (ds) => {
    setEditDatasetId(ds.id);
    setNewDatasetName(ds.name);
    setNewDatasetType(ds.type || "detect");
    setNewDatasetDescription(ds.description || "");
    setNewDatasetCover(ds.coverImage || null);
    setShowAdd(true);
  };

  // add or edit dataset
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
      if (editDatasetId) {
        // Editing existing dataset
        const existing = await db.datasets.get(editDatasetId);
        if (!existing) return;

        const updatedMeta = {
          ...existing,
          name: newDatasetName,
          description: newDatasetDescription,
          type: newDatasetType,
          coverImage: newDatasetCover,
        };

        await db.datasets.put(updatedMeta);

        if (project.folderHandle) {
          try {
            await fsUtils.addDatasetToProjectMeta(project.folderHandle, {
              id: updatedMeta.id,
              name: updatedMeta.name,
              description: updatedMeta.description,
              type: updatedMeta.type,
              coverImage: updatedMeta.coverImage || null,
              createdAt: updatedMeta.createdAt,
              imageCount: updatedMeta.imageCount || 0,
            });

            // Also update dataset.json
            const dsDir = await project.folderHandle.getDirectoryHandle(updatedMeta.name);
            await fsUtils.writeDatasetMetadata(dsDir, updatedMeta);
          } catch (e) {}
        }

        setDatasets(await fetchDatasetsWithImages(projectId));
        setShowAdd(false);
        return;
      }

      // Adding new dataset
      const datasetId = generateId();
      const datasetMeta = {
        id: datasetId,
        name: newDatasetName,
        description: newDatasetDescription || "",
        type: newDatasetType || "detect",
        coverImage: newDatasetCover || null,
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
        coverImage: datasetMeta.coverImage || null,
        createdAt: datasetMeta.createdAt,
        imageCount: 0,
      });

      // add to IndexedDB
      await db.datasets.add({
        ...datasetMeta,
        folderHandle: await project.folderHandle.getDirectoryHandle(newDatasetName),
      });

      setDatasets(await fetchDatasetsWithImages(projectId));

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
      setNewDatasetCover(null);

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
          setDatasets(await fetchDatasetsWithImages(projectId));
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
      <style>{`
        .hover-card {
          transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out !important;
          cursor: pointer;
        }
        .hover-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 10px 20px rgba(0,0,0,0.15) !important;
        }
      `}</style>
      {/* Global AppModal */}
      <AppModal {...modal} show={modal.show} onClose={closeModal} />

      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-center">
          <Button variant="outline-secondary" className="me-3" onClick={() => navigate("/projects")}>← Back</Button>
          <h2 className="fw-semibold mb-0">{project.name}</h2>
        </div>

        {hasPermission ? (
          <Button variant="primary" onClick={openAddModal}><Plus size={16} className="me-1" /> Add Dataset</Button>
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
              <Card 
                className="p-2 h-100 shadow-sm hover-card" 
                style={{ backgroundColor: themeColors.cardBg, color: themeColors.text }}
                onDoubleClick={() => navigate(`/project/${projectId}/dataset/${ds.id}`)}
              >
                {ds.defaultImage ? (
                  <div
                    style={{
                      height: 140,
                      borderRadius: "10px 10px 0 0",
                      backgroundImage: `url(${ds.defaultImage})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                ) : (
                  <div className="d-flex align-items-center justify-content-center" style={{ height: 140, background: themeColors.toolbarBg, borderRadius: "10px 10px 0 0" }}>
                    <FolderOpen size={20} />
                  </div>
                )}

                <Card.Body>
                  <h5 className="mb-1">{ds.name}</h5>
                  <p className="small" style={{ color: themeColors.subtleText }}>{ds.type || "detect"}</p>
                  <p className="small" style={{ color: themeColors.subtleText }}>{ds.createdAt ? new Date(ds.createdAt).toLocaleString() : ""}</p>

                  <div className="d-flex justify-content-between">
                    <Button size="sm" variant="outline-secondary" onClick={(e) => { e.stopPropagation(); openEditModal(ds); }}><Edit size={14} /></Button>
                    <Button size="sm" variant="outline-danger" onClick={(e) => { e.stopPropagation(); openDeleteDatasetModal(ds); }}><Trash2 size={14} /></Button>
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
          title={editDatasetId ? "Edit Dataset" : "Create Dataset"}
          type="confirm"
          confirmText={editDatasetId ? "Save" : "Create"}
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

              <Form.Group className="mb-2">
                <Form.Label>Cover Image (Optional)</Form.Label>
                <Form.Control
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                      try {
                        const base64 = await resizeImageFile(file);
                        setNewDatasetCover(base64);
                      } catch (err) {
                        console.error(err);
                      }
                    }
                  }}
                />
                {newDatasetCover && (
                  <div className="mt-2">
                    <img src={newDatasetCover} style={{ height: 60, borderRadius: 5, objectFit: "cover" }} alt="preview" />
                  </div>
                )}
              </Form.Group>

              <Form.Group>
                <Form.Label>Type</Form.Label>
                <Form.Select value={newDatasetType} onChange={(e) => setNewDatasetType(e.target.value)} disabled={!!editDatasetId}>
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
