import React, { useEffect, useState, useRef } from "react";
import { Card, Row, Col, Button, Form, Spinner, Dropdown, InputGroup, FormControl } from "react-bootstrap";
import { useNavigate, useParams } from "react-router-dom";
import { CheckSquare, Square } from "lucide-react";
import { db } from "../../utils/db";
import { useTheme } from "../../components/ThemeContext";
import AppModal from "../../components/AppModal";

export default function DatasetGalleryPage({ datasetId }) {
  const { projectId } = useParams();
  const { themeColors } = useTheme();
  const navigate = useNavigate();

  const [images, setImages] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedClasses, setSelectedClasses] = useState(new Set());
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Map<imageName, Set<className>> for synchronous filtering
  const [imageLabelsMap, setImageLabelsMap] = useState(new Map());

  // Modal state
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

  const openModal = (data) => setModal({ ...modal, ...data, show: true });
  const closeModal = () => setModal((prev) => ({ ...prev, show: false, onConfirm: null }));

  const createdUrlsRef = useRef(new Set());

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    (async () => {
      try {
        const [ds, proj] = await Promise.all([
          db.datasets.get(datasetId),
          db.projects.get(projectId),
        ]);
        if (!ds) return;

        const jobs = await db.jobs.where({ datasetId, status: "completed" }).toArray();
        const jobIds = jobs.map((j) => j.id);

        const imgs = await db.images.where("jobId").anyOf(jobIds).toArray();

        const resolved = [];
        for (const img of imgs) {
          let url = null;
          try {
            // Try to get dataset folder handle (from dataset or project)
            const dsFolder = ds.folderHandle || (proj?.folderHandle ? await proj.folderHandle.getDirectoryHandle(ds.name).catch(() => null) : null);

            if (dsFolder) {
              try {
                // images are stored under images/raw/<name>
                const imagesDir = await dsFolder.getDirectoryHandle("images");
                const rawDir = await imagesDir.getDirectoryHandle("raw");
                const fh = await rawDir.getFileHandle(img.name);
                const file = await fh.getFile();
                url = URL.createObjectURL(file);
                createdUrlsRef.current.add(url);
              } catch { }
            }
            if (!url && img.url) url = img.url;
          } catch (e) {
            console.warn("Failed to create URL for image", img.name, e);
          }
          resolved.push({ ...img, url });
        }

        if (!mounted) return;
        setImages(resolved);

        // derive classes from annotations
        const allAnn = await db.annotations.where("datasetId").equals(datasetId).toArray();
        const labels = new Set();
        const map = new Map();

        for (const ann of allAnn) {
          const arr = ann?.data ?? [];
          const imgLabels = new Set();
          for (const a of arr) {
            if (a.className) {
              labels.add(a.className);
              imgLabels.add(a.className);
            }
          }
          if (imgLabels.size > 0) {
            // Use imageId as key for robustness
            map.set(ann.imageId, imgLabels);
          }
        }
        labels.add(null); // include images with no annotations
        setClasses(Array.from(labels));
        setImageLabelsMap(map);
      } catch (err) {
        console.error("Failed to load images/classes:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      createdUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      createdUrlsRef.current.clear();
      mounted = false;
    };
  }, [datasetId, projectId]);

  useEffect(() => {
    setSelectedImages(new Set());
  }, [searchQuery, selectedClasses]);

  const toggleClass = (cls) => {
    setSelectedClasses((prev) => {
      const copy = new Set(prev);
      copy.has(cls) ? copy.delete(cls) : copy.add(cls);
      return copy;
    });
  };

  const toggleImageSelect = (id) => {
    setSelectedImages((prev) => {
      const copy = new Set(prev);
      copy.has(id) ? copy.delete(id) : copy.add(id);
      return copy;
    });
  };

  const deleteSelectedImages = async () => {
    if (selectedImages.size === 0) return;

    openModal({
      type: "confirm",
      title: "Delete Images?",
      message: `Are you sure you want to delete ${selectedImages.size} selected images?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        setLoading(true);
        try {
          for (const id of selectedImages) await db.images.delete(id);
          setImages((prev) => prev.filter((img) => !selectedImages.has(img.id)));
          setSelectedImages(new Set());
          return true;
        } catch (err) {
          console.error("Failed to delete images:", err);
          return false;
        } finally {
          setLoading(false);
        }
      },
      autoClose: true,
    });
  };

  // Filter images by search and selected classes
  const filteredImages = images.filter((img) => {
    if (searchQuery && !img.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;

    if (selectedClasses.size === 0) return true;

    // Synchronous lookup using pre-computed map (keyed by imageId)
    const imgLabels = imageLabelsMap.get(img.id);

    // If image has no labels in map, it matches "Unlabeled" (null) filter
    if (!imgLabels && selectedClasses.has(null)) return true;

    // If image has labels, check if any match selected classes
    if (imgLabels) {
      for (const cls of imgLabels) {
        if (selectedClasses.has(cls)) return true;
      }
    }

    return false;
  });

  if (loading)
    return (
      <div style={{ height: "60vh", display: "flex", justifyContent: "center", alignItems: "center" }}>
        <Spinner animation="border" role="status" />
      </div>
    );

  return (
    <div>
      <AppModal {...modal} show={modal.show} onClose={closeModal} />
      {/* Toolbar */}
      <div >
        <div className="d-flex justify-content-start align-items-center mb-3 flex-wrap gap-2">
          <InputGroup style={{ maxWidth: 250 }}>
            <FormControl
              placeholder="Search by image name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </InputGroup>

          <Dropdown autoClose="outside">
            <Dropdown.Toggle
              size="sm"
              variant="outline-secondary"
              id="dropdown-basic"
              style={{
                background: themeColors.buttonBg,
                color: themeColors.text,
                borderColor: themeColors.border,
              }}
            >
              Classes Filter
            </Dropdown.Toggle>
            <Dropdown.Menu
              style={{
                maxHeight: 200,
                overflowY: "auto",
                padding: "0.5rem",
                backgroundColor: themeColors.cardBg,
                color: themeColors.text,
                border: `1px solid ${themeColors.border}`,
              }}
            >
              {classes.map((cls, idx) => (
                <div
                  key={idx}
                  className="dropdown-item-custom"
                  style={{ padding: "4px 8px", cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent dropdown close
                    toggleClass(cls);
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {selectedClasses.has(cls) ? (
                      <CheckSquare size={16} color={themeColors.primary} />
                    ) : (
                      <Square size={16} color={themeColors.text} />
                    )}
                    <span>{cls ?? "Unlabeled"}</span>
                  </div>
                </div>
              ))}
            </Dropdown.Menu>
          </Dropdown>

          <Button size="sm" variant="outline-danger" onClick={deleteSelectedImages}>
            Delete Selected
          </Button>
        </div>
        <div>
          <strong>{filteredImages.length} images</strong>
        </div>
      </div>

      {/* Image Grid */}
      <Row xs={2} sm={3} md={4} lg={5} className="g-3">
        {filteredImages.map((img) => (
          <Col key={img.id}>
            <Card
              style={{
                position: "relative",
                background: themeColors.cardBg,
                color: themeColors.text,
                border: selectedImages.has(img.id)
                  ? `2px solid ${themeColors.primary}`
                  : `1px solid ${themeColors.border}`,
                cursor: "pointer",
                transition: "0.2s",
              }}
            >
              <div style={{ position: "absolute", top: 5, left: 5, zIndex: 10 }}>
                <div onClick={() => toggleImageSelect(img.id)}>
                  {selectedImages.has(img.id) ? (
                    <CheckSquare color={themeColors.primary} />
                  ) : (
                    <Square color={themeColors.text} />
                  )}
                </div>
              </div>

              <div style={{ height: 120, overflow: "hidden", borderRadius: "8px 8px 0 0" }}>
                <img
                  src={img.url}
                  alt={img.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={(e) => console.warn("Image failed to load:", img.name)}
                />
              </div>

              <div style={{ position: "absolute", top: 3, right: 5, zIndex: 10 }}>
                <Button
                  size="sm"
                  variant="outline-primary"
                  className="mt-1 p-1"
                  style={{ fontSize: "0.65rem" }}
                  onClick={() =>
                    navigate(`/annotate/${projectId}/${datasetId}/${img.jobId || ""}?imageId=${img.id}`)
                  }
                >
                  🖊
                </Button>
              </div>
              <div style={{ position: "absolute", top: 5, left: 5, zIndex: 10 }}></div>

              <Card.Body className="p-2 text-center">
                <div style={{ fontSize: "0.8rem", color: themeColors.subtleText }}>{img.name}</div>

              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
