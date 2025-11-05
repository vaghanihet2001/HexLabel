import React, { useEffect, useState, useRef } from "react";
import { Card, Row, Col, Button, Form, Spinner, Dropdown, InputGroup, FormControl } from "react-bootstrap";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../../utils/db";
import { useTheme } from "../../components/ThemeContext";

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

  const createdUrlsRef = useRef(new Set());

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    (async () => {
      try {
        const ds = await db.datasets.get(datasetId);
        if (!ds) return;

        const jobs = await db.jobs.where({ datasetId, status: "completed" }).toArray();
        const jobIds = jobs.map((j) => j.id);

        const imgs = await db.images.where("jobId").anyOf(jobIds).toArray();

        const resolved = [];
        for (const img of imgs) {
          let url = null;
          try {
            if (ds.folderHandle) {
              try {
                const rawDir = await ds.folderHandle.getDirectoryHandle("raw_images", { create: false });
                const fh = await rawDir.getFileHandle(img.name);
                const file = await fh.getFile();
                url = URL.createObjectURL(file);
                createdUrlsRef.current.add(url);
              } catch {}
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
        for (const ann of allAnn) {
          const arr = ann?.data ?? [];
          for (const a of arr) {
            if (a.className) labels.add(a.className);
          }
        }
        labels.add(null); // include images with no annotations
        setClasses(Array.from(labels));
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
    if (!confirm("Delete selected images?")) return;

    setLoading(true);
    try {
      for (const id of selectedImages) await db.images.delete(id);
      setImages((prev) => prev.filter((img) => !selectedImages.has(img.id)));
      setSelectedImages(new Set());
    } catch (err) {
      console.error("Failed to delete images:", err);
    } finally {
      setLoading(false);
    }
  };

  // Filter images by search and selected classes
  const filteredImages = images.filter((img) => {
    if (searchQuery && !img.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;

    if (selectedClasses.size === 0) return true;

    const ann = db.annotations.where({ datasetId, imageName: img.name }).first().catch(() => null);
    if (!ann && selectedClasses.has(null)) return true;
    if (!ann) return false;

    const classNames = (ann.data ?? []).map((a) => a.className);
    return Array.from(selectedClasses).some((cls) => cls === null || classNames.includes(cls));
  });

  if (loading)
    return (
      <div style={{ height: "60vh", display: "flex", justifyContent: "center", alignItems: "center" }}>
        <Spinner animation="border" role="status" />
      </div>
    );

  return (
    <div>
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

        <Dropdown>
          <Dropdown.Toggle size="sm" variant="outline-secondary">
            Classes Filter
          </Dropdown.Toggle>
          <Dropdown.Menu style={{ maxHeight: 200, overflowY: "auto", padding: "0.5rem" }}>
            {classes.map((cls, idx) => (
              <Form.Check
              key={idx}
              type="checkbox"
              id={`class-${idx}`}
              label={cls ?? "Unlabeled"}
              checked={selectedClasses.has(cls)}
              onChange={() => toggleClass(cls)}
              />
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
                <Form.Check
                  type="checkbox"
                  checked={selectedImages.has(img.id)}
                  onChange={() => toggleImageSelect(img.id)}
                />
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
