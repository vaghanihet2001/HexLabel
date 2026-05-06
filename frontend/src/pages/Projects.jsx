// frontend/src/pages/Projects.jsx

import React, { useEffect, useState } from "react";
import {
  Card,
  Button,
  Row,
  Col,
  Modal,
  Form,
  OverlayTrigger,
  Tooltip,
} from "react-bootstrap";

import { useTheme } from "../components/ThemeContext";
import AppModal from "../components/AppModal";

import {
  Edit,
  Trash2,
  Plus,
  Database,
  Cpu,
  FolderOpen,
  Lock,
  Upload,
} from "lucide-react";

import { db } from "../utils/db";
import { deleteProject } from "../utils/cleanup";
import { resizeImageFile } from "../utils/imageUtils";

// ⭐ NEW – DB REBUILD SCRIPT
import { rebuildDatabaseFromProject } from "../utils/rebuild";

export default function Projects() {
  const { themeColors } = useTheme();

  const [projects, setProjects] = useState([]);
  const [showEdit, setShowEdit] = useState(false);
  const [currentProject, setCurrentProject] = useState(null);

  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [loading, setLoading] = useState(false);

  // -----------------------------
  // GLOBAL MODAL
  // -----------------------------
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

  const openModal = (data) => {
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
  };

  const closeModal = () =>
    setModal((prev) => ({
      ...prev,
      show: false,
      onConfirm: null,
      autoClose: false,
    }));

  // -----------------------------
  // LOAD PROJECTS (DB → UI)
  // -----------------------------
  const reloadProjects = async () => {
    const list = await db.projects.toArray();

    const projectsWithCounts = await Promise.all(
      list.map(async (proj) => {
        const datasetCount = await db.datasets
          .where("projectId")
          .equals(proj.id)
          .count();

        let defaultImage = proj.coverImage;
        if (!defaultImage) {
          const firstDs = await db.datasets.where("projectId").equals(proj.id).first();
          if (firstDs) {
            const firstImg = await db.images.where("datasetId").equals(firstDs.id).first();
            if (firstImg) {
              if (firstImg.url && !firstImg.url.startsWith("blob:")) {
                defaultImage = firstImg.url;
              } else if (firstDs.folderHandle) {
                try {
                  const imagesDir = await firstDs.folderHandle.getDirectoryHandle("images");
                  const rawDir = await imagesDir.getDirectoryHandle("raw");
                  const fh = await rawDir.getFileHandle(firstImg.name);
                  const file = await fh.getFile();
                  defaultImage = URL.createObjectURL(file);
                } catch (e) {}
              }
            }
          }
        }

        return { ...proj, datasets: datasetCount, defaultImage };
      })
    );

    setProjects(projectsWithCounts);
  };

  useEffect(() => {
    reloadProjects();
  }, []);

  // -----------------------------
  // SELECT FOLDER FOR NEW PROJECT
  // -----------------------------
  const handleSelectFolder = async () => {
    try {
      const folder = await window.showDirectoryPicker();
      const perm = await folder.requestPermission({ mode: "readwrite" });

      if (perm !== "granted") {
        setPermissionNeeded(true);
        return openModal({
          type: "error",
          title: "Permission Required",
          message: "Write permission is required.",
        });
      }

      setCurrentProject((prev) => ({
        ...prev,
        folderHandle: folder,
      }));
    } catch (err) {
      console.warn("Folder selection canceled:", err);
    }
  };

  // -----------------------------
  // WRITE HEXLABEL PROJECT FILE
  // -----------------------------
  const saveProjectMetadataToDisk = async (project) => {
    try {
      const file = await project.folderHandle.getFileHandle(
        "hexlabel.project.json",
        { create: true }
      );

      let existingDatasets = [];
      try {
        const fileData = await file.getFile();
        const text = await fileData.text();
        const parsed = JSON.parse(text);
        if (parsed.datasets) existingDatasets = parsed.datasets;
      } catch (e) {}

      const writable = await file.createWritable();
      await writable.write(
        JSON.stringify(
          {
            id: project.id,
            name: project.name,
            description: project.description,
            coverImage: project.coverImage || null,
            createdAt: project.createdAt,
            datasets: existingDatasets,
          },
          null,
          2
        )
      );
      await writable.close();
    } catch (err) {
      openModal({
        type: "error",
        title: "Write Error",
        message: "Failed to write hexlabel.project.json",
      });
    }
  };

  // -----------------------------
  // SAVE / EDIT PROJECT
  // -----------------------------
  const handleSaveProject = async (e) => {
    e.preventDefault();

    if (!currentProject.folderHandle) {
      return openModal({
        type: "error",
        title: "Folder Required",
        message: "Please select a project folder.",
      });
    }

    const fh = currentProject.folderHandle;
    let perm = await fh.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") perm = await fh.requestPermission({ mode: "readwrite" });

    if (perm !== "granted") {
      return openModal({
        type: "error",
        title: "Permission Denied",
        message: "Write permission is required.",
      });
    }

    const record = {
      id: currentProject.id || crypto.randomUUID(),
      name: currentProject.name,
      description: currentProject.description,
      datasets: currentProject.datasets || 0,
      models: currentProject.models || 0,
      folderHandle: fh,
      coverImage: currentProject.coverImage || null,
      createdAt: currentProject.createdAt || new Date().toISOString(),
    };

    await db.projects.put(record);
    await saveProjectMetadataToDisk(record);

    setShowEdit(false);
    setCurrentProject(null);
    setPermissionNeeded(false);
    await reloadProjects();
  };

  // -----------------------------
  // LOAD EXISTING PROJECT
  // (Rebuild DB here if needed)
  // -----------------------------
  const handleLoadProject = async () => {
    try {
      setLoading(true);

      const folder = await window.showDirectoryPicker();
      const perm = await folder.requestPermission({ mode: "readwrite" });

      if (perm !== "granted") {
        return openModal({
          type: "error",
          title: "Permission Required",
          message: "Read/write permission is required.",
        });
      }

      // --- LOAD hexlabel.project.json ---
      let metaFile;
      try {
        metaFile = await folder.getFileHandle("hexlabel.project.json");
      } catch {
        return openModal({
          type: "error",
          title: "Invalid Project",
          message: "hexlabel.project.json not found.",
        });
      }

      const data = JSON.parse(await (await metaFile.getFile()).text());

      // -----------------------------
      // ⭐ NEW — FULL DB REBUILD HERE
      // -----------------------------
      await rebuildDatabaseFromProject(folder);

      openModal({
        type: "success",
        title: "Project Loaded",
        message: `"${data.name}" loaded successfully.`,
      });

      await reloadProjects();
    } catch (err) {
      openModal({
        type: "error",
        title: "Load Failed",
        message: "Could not load project folder.",
      });
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------
  // DELETE PROJECT
  // -----------------------------
  const askDeleteProject = (project) => {
    setCurrentProject(project);

    openModal({
      type: "confirm",
      title: "Delete Project?",
      message: `Are you sure you want to delete "${project.name}"?\nThis will delete ALL datasets, images, versions, AND the filesystem folder.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        try {
          await deleteProject(project.id);
          await reloadProjects();
          return true;
        } catch (err) {
          console.error("Failed to delete project:", err);
          alert(`Failed to delete project: ${err.message}`);
          return false;
        }
      },
      autoClose: true,
    });
  };

  // -----------------------------
  // OPEN PROJECT BUTTON
  // (Rebuild → Then navigate)
  // -----------------------------
  const handleOpenProject = async (project) => {
    if (!project.folderHandle) {
      return openModal({
        type: "error",
        title: "Missing Folder",
        message: "This project has no folder handle. Load it again.",
      });
    }

    const perm = await project.folderHandle.requestPermission({
      mode: "readwrite",
    });

    if (perm !== "granted") {
      return openModal({
        type: "error",
        title: "Permission Required",
        message: "Grant permission to access this project folder.",
      });
    }

    // ⭐ SAFE — RUN REBUILD BEFORE NAVIGATION
    await rebuildDatabaseFromProject(project.folderHandle);

    window.location.href = `/project/${project.id}`;
  };

  // -----------------------------
  // UI
  // -----------------------------
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
      <AppModal {...modal} show={modal.show} onClose={closeModal} />

      {/* HEADER */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="fw-semibold">Projects</h2>

        <div className="d-flex gap-2">
          <Button variant="outline-success" onClick={handleLoadProject}>
            <Upload size={16} className="me-1" /> Load Project
          </Button>

          <Button
            variant="primary"
            onClick={() => {
              setCurrentProject({
                id: null,
                name: "",
                description: "",
                datasets: 0,
                models: 0,
                folderHandle: null,
              });
              setShowEdit(true);
            }}
          >
            <Plus size={16} className="me-1" /> Add Project
          </Button>
        </div>
      </div>

      {/* PROJECT GRID */}
      <Row xs={1} sm={2} md={3} lg={4} className="g-4">
        {projects.map((project) => (
          <Col key={project.id}>
            <Card 
              className="p-2 h-100 shadow-sm hover-card"
              onDoubleClick={() => handleOpenProject(project)}
            >
              {project.defaultImage ? (
                <div
                  style={{
                    height: 140,
                    borderRadius: "10px 10px 0 0",
                    backgroundImage: `url(${project.defaultImage})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
              ) : (
                <div
                  className="d-flex align-items-center justify-content-center"
                  style={{
                    height: 140,
                    borderRadius: "10px 10px 0 0",
                    background: themeColors.toolbarBg,
                  }}
                >
                  <FolderOpen size={28} />
                </div>
              )}

              <Card.Body>
                <h5 className="mb-1">{project.name}</h5>
                <p style={{ minHeight: 40, color: themeColors.subtleText }}>
                  {project.description}
                </p>

                <div className="d-flex justify-content-between mb-2">
                  <span>
                    <Database size={14} className="me-1" />
                    {project.datasets}
                  </span>
                  <span>
                    <Cpu size={14} className="me-1" />
                    {project.models}
                  </span>
                </div>

                <div className="d-flex justify-content-between">
                  <div>
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      className="me-2"
                      onClick={() => {
                        setCurrentProject(project);
                        setShowEdit(true);
                      }}
                    >
                      <Edit size={12} />
                    </Button>

                    <Button
                      size="sm"
                      variant="outline-danger"
                      onClick={() => askDeleteProject(project)}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>

                  <div>
                    {/* PERMISSION */}
                    <OverlayTrigger
                      placement="top"
                      overlay={<Tooltip>Grant Permission</Tooltip>}
                    >
                      <Button
                        size="sm"
                        variant="outline-warning"
                        className="ms-2"
                        onClick={() =>
                          project.folderHandle?.requestPermission({
                            mode: "readwrite",
                          })
                        }
                      >
                        <Lock size={12} />
                      </Button>
                    </OverlayTrigger>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      {/* ADD/EDIT PROJECT MODAL */}
      <Modal show={showEdit} onHide={() => setShowEdit(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {currentProject?.id ? "Edit Project" : "Add Project"}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Form onSubmit={handleSaveProject}>
            <Form.Group className="mb-3">
              <Form.Label>Project Name</Form.Label>
              <Form.Control
                type="text"
                value={currentProject?.name || ""}
                onChange={(e) =>
                  setCurrentProject({
                    ...currentProject,
                    name: e.target.value,
                  })
                }
                required
              />
            </Form.Group>

            <Form.Group>
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={currentProject?.description || ""}
                onChange={(e) =>
                  setCurrentProject({
                    ...currentProject,
                    description: e.target.value,
                  })
                }
              />
            </Form.Group>

            <Form.Group className="mt-3">
              <Form.Label>Cover Image (Optional)</Form.Label>
              <Form.Control
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (file) {
                    try {
                      const base64 = await resizeImageFile(file);
                      setCurrentProject({ ...currentProject, coverImage: base64 });
                    } catch (err) {
                      console.error("Failed to resize image", err);
                    }
                  }
                }}
              />
              {currentProject?.coverImage && (
                <div className="mt-2">
                   <img src={currentProject.coverImage} style={{ height: 60, borderRadius: 5, objectFit: "cover" }} alt="cover preview" />
                </div>
              )}
            </Form.Group>

            <Form.Group className="mt-3">
              <Form.Label>Project Folder</Form.Label>
              <div className="d-flex align-items-center gap-2">
                <Button variant="outline-primary" size="sm" onClick={handleSelectFolder}>
                  Select Folder
                </Button>

                <span>
                  {currentProject?.folderHandle
                    ? `📁 ${currentProject.folderHandle.name}`
                    : "No folder selected"}
                </span>

                {permissionNeeded && (
                  <span className="text-danger small">Permission required</span>
                )}
              </div>
            </Form.Group>

            <div className="d-flex justify-content-end mt-4">
              <Button
                variant="secondary"
                className="me-2"
                onClick={() => setShowEdit(false)}
              >
                Cancel
              </Button>

              <Button variant="primary" type="submit">
                Save Project
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </div>
  );
}
