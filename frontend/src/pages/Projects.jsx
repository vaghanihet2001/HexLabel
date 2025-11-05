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
import {
  Edit,
  Trash2,
  Plus,
  Database,
  Cpu,
  FolderOpen,
  Lock,
} from "lucide-react";
import { db } from "../utils/db";

export default function Projects() {
  const { themeColors } = useTheme();
  const [projects, setProjects] = useState([]);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [currentProject, setCurrentProject] = useState(null);
  const [permissionNeeded, setPermissionNeeded] = useState(false);

  // ✅ Load projects and compute dataset counts dynamically
  useEffect(() => {
    const init = async () => {
      const projectsWithCounts = await Promise.all(
        (await db.projects.toArray()).map(async (proj) => {
          const count = await db.datasets
            .where("projectId")
            .equals(proj.id)
            .count();
          return { ...proj, datasets: count };
        })
      );
      setProjects(projectsWithCounts);
    };
    init();
  }, []);

  // ✅ Folder selection with write permission
  const handleSelectFolder = async () => {
    try {
      const handle = await window.showDirectoryPicker();
      const perm = await handle.requestPermission({ mode: "readwrite" });
      if (perm !== "granted") {
        alert(
          "Write permission not granted. Please allow access to save project data."
        );
        setPermissionNeeded(true);
        setCurrentProject((p) => ({ ...p, folderHandle: handle }));
        return;
      }
      setPermissionNeeded(false);
      setCurrentProject((p) => ({ ...p, folderHandle: handle }));
    } catch (err) {
      console.warn("Folder selection cancelled or failed:", err);
    }
  };

  // ✅ Save or update a project
  const handleSaveProject = async (e) => {
    e.preventDefault();
    if (!currentProject) return;
    if (!currentProject.folderHandle) {
      alert("Please select a project folder before saving.");
      return;
    }

    const fh = currentProject.folderHandle;
    let perm = await fh.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      perm = await fh.requestPermission({ mode: "readwrite" });
    }
    if (perm !== "granted") {
      alert("Write permission required to save project. Please grant access.");
      setPermissionNeeded(true);
      return;
    }

    const toStore = {
      id: currentProject.id || crypto.randomUUID(),
      name: currentProject.name,
      description: currentProject.description,
      datasets: currentProject.datasets || 0,
      models: currentProject.models || 0,
      folderHandle: fh,
      createdAt: currentProject.createdAt || new Date().toISOString(),
    };

    try {
      await db.projects.put(toStore);

      const projectsWithCounts = await Promise.all(
        (await db.projects.toArray()).map(async (proj) => {
          const count = await db.datasets
            .where("projectId")
            .equals(proj.id)
            .count();
          return { ...proj, datasets: count };
        })
      );

      setProjects(projectsWithCounts);
      setShowEdit(false);
      setCurrentProject(null);
      setPermissionNeeded(false);
    } catch (err) {
      console.error("Failed to save project:", err);
      alert("Failed to save project. See console for details.");
    }
  };

  // ✅ Delete a project and all related data
  const handleDeleteProject = async () => {
    if (!currentProject) return;
    const projectId = currentProject.id;

    try {
      const datasets = await db.datasets
        .where("projectId")
        .equals(projectId)
        .toArray();

      for (const ds of datasets) {
        await db.datasetVersions.where("datasetId").equals(ds.id).delete();
        await db.annotations.where("datasetId").equals(ds.id).delete();
        await db.images.where("datasetId").equals(ds.id).delete();
        await db.jobs.where("datasetId").equals(ds.id).delete();
        await db.tempImages.where("datasetId").equals(ds.id).delete();
      }

      await db.datasets.where("projectId").equals(projectId).delete();
      await db.projects.delete(projectId);

      const projectsWithCounts = await Promise.all(
        (await db.projects.toArray()).map(async (proj) => {
          const count = await db.datasets
            .where("projectId")
            .equals(proj.id)
            .count();
          return { ...proj, datasets: count };
        })
      );

      setProjects(projectsWithCounts);
      setShowDelete(false);
      setCurrentProject(null);
    } catch (err) {
      console.error("Error deleting project:", err);
      alert("Failed to delete project. Check console for details.");
    }
  };

  // ✅ Grant permission to existing project folder
  const handleGrantPermissionForProject = async (proj) => {
    if (!proj?.folderHandle) {
      alert("No folder handle present — reselect folder.");
      return;
    }
    try {
      const perm = await proj.folderHandle.requestPermission({
        mode: "readwrite",
      });
      if (perm === "granted") {
        alert("Permission granted. You can now create datasets inside this project.");
      } else {
        alert("Permission not granted.");
      }
    } catch (err) {
      console.error(err);
      alert("Permission request failed.");
    }
  };

  const cardStyle = {
    backgroundColor: themeColors.cardBg,
    color: themeColors.text,
    border: `2px solid ${themeColors.border}`,
    borderRadius: "12px",
    boxShadow: "0 4px 10px rgba(0,0,0,0.05)",
  };

  return (
    <div
      className="p-4"
      style={{
        backgroundColor: themeColors.background,
        color: themeColors.text,
      }}
    >
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="fw-semibold mb-0">Projects</h2>
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
            setPermissionNeeded(false);
          }}
        >
          <Plus size={16} className="me-1" />
          Add Project
        </Button>
      </div>

      <Row xs={1} sm={2} md={3} lg={4} className="g-4">
        {projects.map((project) => (
          <Col key={project.id}>
            <Card style={cardStyle} className="p-2 h-100">
              <div
                style={{
                  height: 140,
                  borderRadius: 10,
                  background: themeColors.toolbarBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FolderOpen size={28} />
              </div>
              <Card.Body className="pt-2">
                <h5 className="mb-1">{project.name}</h5>
                <p style={{ opacity: 0.8, minHeight: 40 }}>
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
                      onClick={() => {
                        setCurrentProject(project);
                        setShowDelete(true);
                      }}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>

                  <div>
                    <OverlayTrigger
                      placement="top"
                      overlay={<Tooltip>Open Project</Tooltip>}
                    >
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => {
                          window.location.href = `/project/${project.id}`;
                        }}
                      >
                        Open
                      </Button>
                    </OverlayTrigger>

                    <OverlayTrigger
                      placement="top"
                      overlay={<Tooltip>Check / Grant Access</Tooltip>}
                    >
                      <Button
                        size="sm"
                        variant="outline-warning"
                        className="ms-2"
                        onClick={() => handleGrantPermissionForProject(project)}
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

      {/* Add/Edit Modal */}
      <Modal show={showEdit} onHide={() => setShowEdit(false)} centered>
        <Modal.Header
          closeButton
          style={{
            backgroundColor: themeColors.cardBg,
            color: themeColors.text,
            borderColor: themeColors.border,
          }}
        >
          <Modal.Title>
            {currentProject?.id ? "Edit Project" : "Add Project"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body
          style={{
            backgroundColor: themeColors.cardBg,
            color: themeColors.text,
            borderColor: themeColors.border,
          }}
        >
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

            <Form.Group className="mb-3">
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

            <Form.Group className="mb-3">
              <Form.Label>Project Folder</Form.Label>
              <div className="d-flex align-items-center gap-2">
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={handleSelectFolder}
                >
                  Select Folder
                </Button>
                <div>
                  {currentProject?.folderHandle ? (
                    <span>✅ {currentProject.folderHandle.name}</span>
                  ) : (
                    <span>No folder selected</span>
                  )}
                  {permissionNeeded && (
                    <div className="text-danger small mt-1">
                      Write permission required
                    </div>
                  )}
                </div>
              </div>
            </Form.Group>

            <div className="d-flex justify-content-end">
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

      {/* Delete Modal */}
      <Modal show={showDelete} onHide={() => setShowDelete(false)} centered>
        <Modal.Header
          closeButton
          style={{
            backgroundColor: themeColors.cardBg,
            color: themeColors.text,
            borderColor: themeColors.border,
          }}
        >
          <Modal.Title>Confirm Deletion</Modal.Title>
        </Modal.Header>
        <Modal.Body
          style={{
            backgroundColor: themeColors.cardBg,
            color: themeColors.text,
            borderColor: themeColors.border,
          }}
        >
          Are you sure you want to delete Project:{" "}
          <strong>{currentProject?.name}</strong>?
          <div className="text-danger small mt-2">
            This will delete all datasets, images, annotations, and jobs.
          </div>
        </Modal.Body>
        <Modal.Footer
          style={{
            backgroundColor: themeColors.cardBg,
            color: themeColors.text,
            borderColor: themeColors.border,
          }}
        >
          <Button variant="secondary" onClick={() => setShowDelete(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteProject}>
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
