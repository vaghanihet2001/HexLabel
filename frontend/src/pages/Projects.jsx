import React, { useState } from "react";
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
import { Edit, Trash2, Plus, Database, Cpu } from "lucide-react";

export default function Projects() {
  const { themeColors } = useTheme();

  // --- Sample project data ---
  const [projects, setProjects] = useState([
    {
      id: 1,
      name: "Vehicle Detection v2",
      description: "Detect cars, trucks, and buses from aerial view.",
      image: "",
      datasets: 3,
      models: 2,
    },
    {
      id: 2,
      name: "Pedestrian Segmentation",
      description: "Pixel-wise segmentation of pedestrians.",
      image: "",
      datasets: 4,
      models: 1,
    },
    {
      id: 3,
      name: "Road Damage Classification",
      description: "Classify cracks, potholes, and surface damage.",
      image: "",
      datasets: 2,
      models: 3,
    },
  ]);

  // --- Modal state ---
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [currentProject, setCurrentProject] = useState(null);

  // --- Add/Edit Project ---
  const handleSaveProject = (e) => {
    e.preventDefault();
    if (currentProject.id) {
      // Update existing project
      setProjects((prev) =>
        prev.map((p) => (p.id === currentProject.id ? currentProject : p))
      );
    } else {
      // Add new
      setProjects((prev) => [
        ...prev,
        { ...currentProject, id: Date.now(), image: "" },
      ]);
    }
    setShowEdit(false);
  };

  // --- Delete Project ---
  const handleDeleteProject = () => {
    setProjects((prev) => prev.filter((p) => p.id !== currentProject.id));
    setShowDelete(false);
  };

  // --- Styling ---
  const cardStyle = {
    backgroundColor: themeColors.cardBg,
    color: themeColors.text,
    border: `1px solid ${themeColors.border}`,
    borderRadius: "12px",
    boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
    transition: "transform 0.15s ease",
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
        minHeight: "100%",
      }}
    >
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="fw-semibold mb-0">Projects</h2>
        <Button
          variant="primary"
          className="d-flex align-items-center"
          onClick={() => {
            setCurrentProject({
              id: null,
              name: "",
              description: "",
              datasets: 0,
              models: 0,
            });
            setShowEdit(true);
          }}
        >
          <Plus size={18} className="me-1" />
          Add Project
        </Button>
      </div>

      {/* Project Grid */}
      <Row xs={1} sm={2} md={3} lg={4} className="g-4">
        {projects.map((project) => (
          <Col key={project.id}>
            <Card style={cardStyle} className="p-2 h-100">
              {/* Thumbnail */}
              {project.image ? (
                <img
                  src={project.image}
                  alt={project.name}
                  className="img-fluid rounded mb-2"
                  style={{ height: "140px", objectFit: "cover" }}
                />
              ) : (
                <div style={placeholderStyle}>No Image</div>
              )}

              {/* Content */}
              <Card.Body className="pt-2">
                <h5 className="mb-1">{project.name}</h5>
                <p
                  className="mb-2"
                  style={{
                    opacity: 0.8,
                    fontSize: "0.9rem",
                    minHeight: "40px",
                  }}
                >
                  {project.description}
                </p>

                <div className="d-flex justify-content-between mb-2">
                  <span className="d-flex align-items-center">
                    <Database size={16} className="me-1" />
                    {project.datasets} datasets
                  </span>
                  <span className="d-flex align-items-center">
                    <Cpu size={16} className="me-1" />
                    {project.models} models
                  </span>
                </div>

                <div className="d-flex justify-content-between">
                  <OverlayTrigger placement="top" overlay={<Tooltip>Edit</Tooltip>}>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => {
                        setCurrentProject(project);
                        setShowEdit(true);
                      }}
                    >
                      <Edit size={14} />
                    </Button>
                  </OverlayTrigger>

                  <OverlayTrigger placement="top" overlay={<Tooltip>Delete</Tooltip>}>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => {
                        setCurrentProject(project);
                        setShowDelete(true);
                      }}
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

      {/* Edit / Add Modal */}
      <Modal show={showEdit} onHide={() => setShowEdit(false)} centered>
        <Modal.Header closeButton style={{ backgroundColor: themeColors.cardBg }}>
          <Modal.Title>
            {currentProject?.id ? "Edit Project" : "Add Project"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ backgroundColor: themeColors.background }}>
          <Form onSubmit={handleSaveProject}>
            <Form.Group className="mb-3">
              <Form.Label>Name</Form.Label>
              <Form.Control
                type="text"
                value={currentProject?.name || ""}
                onChange={(e) =>
                  setCurrentProject({ ...currentProject, name: e.target.value })
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

            <Form.Group className="mb-3 d-flex gap-2">
              <Form.Control
                type="number"
                min={0}
                value={currentProject?.datasets || 0}
                onChange={(e) =>
                  setCurrentProject({
                    ...currentProject,
                    datasets: parseInt(e.target.value) || 0,
                  })
                }
                placeholder="Datasets count"
              />
              <Form.Control
                type="number"
                min={0}
                value={currentProject?.models || 0}
                onChange={(e) =>
                  setCurrentProject({
                    ...currentProject,
                    models: parseInt(e.target.value) || 0,
                  })
                }
                placeholder="Models count"
              />
            </Form.Group>

            <div className="d-flex justify-content-end">
              <Button variant="secondary" className="me-2" onClick={() => setShowEdit(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                Save
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      {/* Delete Modal */}
      <Modal show={showDelete} onHide={() => setShowDelete(false)} centered>
        <Modal.Header closeButton style={{ backgroundColor: themeColors.cardBg }}>
          <Modal.Title>Confirm Deletion</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ backgroundColor: themeColors.background }}>
          Are you sure you want to delete{" "}
          <strong>{currentProject?.name}</strong>? This action cannot be undone.
        </Modal.Body>
        <Modal.Footer style={{ backgroundColor: themeColors.cardBg }}>
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
