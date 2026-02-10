// frontend/src/pages/dataset/UploadImagesPage.jsx
import React, { useState, useEffect, useRef } from "react";
import { Button, Card, Row, Col, Form, Spinner } from "react-bootstrap";
import { db } from "../../utils/db";
import { useTheme } from "../../components/ThemeContext";
import { CheckSquare, Square, UploadCloud, Video } from "lucide-react";
import AppModal from "../../components/AppModal";
import VideoImportModal from "../../components/VideoImportModal";

import {
  readDatasetMetadata,
  writeDatasetMetadata,
  writeJobFile,
} from "../../utils/fs";

export default function UploadImagesPage({ dataset, project, onJobCreated }) {
  const datasetId = dataset?.id;
  const { themeColors, theme } = useTheme();

  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");

  // Video State
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoFile, setVideoFile] = useState(null);

  const createdUrlsRef = useRef(new Set());

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

  const openModal = (d) => setModal({ ...modal, ...d, show: true });
  const closeModal = () => setModal({ ...modal, show: false });

  // -----------------------------
  // VIDEO MODAL HANDLERS
  // -----------------------------
  const handleVideoExtractComplete = async (blobs, videoName) => {
    // Convert blobs to image objects
    const newImgs = [];
    const baseName = videoName.substring(0, videoName.lastIndexOf('.')) || videoName;

    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      const id = crypto.randomUUID();
      const url = URL.createObjectURL(blob);

      // Pad frame number
      const frameNum = String(i + 1).padStart(5, '0');
      const name = `${baseName}_frame_${frameNum}.jpg`;

      const img = {
        id,
        datasetId,
        name,
        originalName: name,
        blob,
        url,
        createdAt: new Date().toISOString(),
      };

      await db.tempImages.put(img);
      newImgs.push(img);
    }

    setImages((p) => [...p, ...newImgs]);
    setShowVideoModal(false);
    setVideoFile(null);
  };

  // -----------------------------
  // DRAG + DROP
  // -----------------------------
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (["dragenter", "dragover"].includes(e.type)) setDragActive(true);
    else setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  // -----------------------------
  // LOAD UNASSIGNED IMAGES
  // -----------------------------
  useEffect(() => {
    if (!datasetId) return;
    let mounted = true;

    const load = async () => {
      setLoading(true);

      try {
        const temp = await db.tempImages.where("datasetId").equals(datasetId).toArray();
        const imported = await db.images.where("datasetId").equals(datasetId).toArray();

        const importedIDs = new Set(imported.map(i => i.id));

        // remove temp images that already imported
        for (const t of temp) {
          if (importedIDs.has(t.id)) {
            await db.tempImages.delete(t.id);
          }
        }

        const freshTemp = await db.tempImages.where("datasetId").equals(datasetId).toArray();

        // remove assigned images
        const assigned = imported.filter(i => i.jobId !== null);
        const assignedIDs = new Set(assigned.map(a => a.id));

        const unassigned = freshTemp.filter(t => !assignedIDs.has(t.id));

        const mapped = unassigned.map(t => ({
          ...t,
          url: t.url || URL.createObjectURL(t.blob)
        }));

        mapped.forEach(t => createdUrlsRef.current.add(t.url));

        if (mounted) {
          setImages(mapped);
          setSelected(new Set());
        }
      } catch (err) {
        console.error("Load error:", err);
      } finally {
        setLoading(false);
      }
    };

    load();
    return () => (mounted = false);
  }, [datasetId]);

  // -----------------------------
  // UPLOAD FILES
  // -----------------------------
  const handleFiles = async (files) => {
    const fileList = Array.from(files);

    // Check for video first
    const video = fileList.find(f => f.type.startsWith("video/"));
    if (video) {
      setVideoFile(video);
      setShowVideoModal(true);
      return; // Only process one video at a time for now, or prioritize video
    }

    const valid = fileList.filter((f) => f.type.startsWith("image/"));
    if (!valid.length) {
      openModal({
        type: "error",
        title: "Invalid files",
        message: "Only image or video files allowed."
      });
      return;
    }

    setLoading(true);
    setStatusText("Uploading...");

    try {
      const newImgs = [];

      for (const file of valid) {
        const id = crypto.randomUUID();
        const ext = file.name.includes(".")
          ? file.name.slice(file.name.lastIndexOf("."))
          : "";

        const blob = new Blob([await file.arrayBuffer()], { type: file.type });
        const url = URL.createObjectURL(blob);

        const img = {
          id,
          datasetId,
          name: id + ext,
          originalName: file.name,
          blob,
          url,
          createdAt: new Date().toISOString(),
        };

        await db.tempImages.put(img);
        newImgs.push(img);
      }

      setImages((p) => [...p, ...newImgs]);
    } finally {
      setLoading(false);
      setStatusText("");
    }
  };

  // -----------------------------
  // SELECTION
  // -----------------------------
  const toggleSelect = (id) =>
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  const selectAll = () => setSelected(new Set(images.map((i) => i.id)));
  const clearSelection = () => setSelected(new Set());

  const deleteSelected = () => {
    if (!selected.size) return;

    openModal({
      type: "confirm",
      title: "Delete?",
      message: "Delete selected images?",
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        for (const id of selected) await db.tempImages.delete(id);
        setImages((p) => p.filter((i) => !selected.has(i.id)));
        clearSelection();
        return true;
      },
      autoClose: true,
    });
  };

  // -----------------------------
  // CREATE JOB → WRITE FILESYSTEM + DB
  // -----------------------------
  const createJob = async () => {
    if (!selected.size) {
      openModal({
        type: "error",
        title: "No images",
        message: "Select at least 1 image."
      });
      return;
    }

    setLoading(true);
    setStatusText("Creating job...");

    try {
      const imagesFolder = await dataset.folderHandle.getDirectoryHandle("images", { create: true });
      const rawFolder = await imagesFolder.getDirectoryHandle("raw", { create: true });

      const imageIds = [];

      // ---------- WRITE IMAGES TO FS ----------
      for (const id of selected) {
        const tempImg = await db.tempImages.get(id);
        if (!tempImg) continue;

        const exists = await db.images.get(id);
        if (exists && exists.jobId !== null) {
          throw new Error(`${tempImg.originalName} already assigned to a job.`);
        }

        const fileHandle = await rawFolder.getFileHandle(tempImg.name, { create: true });
        const w = await fileHandle.createWritable();
        await w.write(await tempImg.blob.arrayBuffer());
        await w.close();

        await db.images.put({
          id: tempImg.id,
          datasetId,
          name: tempImg.name,
          originalName: tempImg.originalName,
          path: `images/raw/${tempImg.name}`,
          createdAt: new Date().toISOString(),
          jobId: null,
        });

        imageIds.push(tempImg.id);
      }

      // ---------- CREATE JOB OBJECT ----------
      const job = {
        id: crypto.randomUUID(),
        datasetId,
        name: `Job - ${new Date().toLocaleString()}`,
        status: "not_started",
        imageIds,
        createdAt: new Date().toISOString(),
      };

      // ---------- WRITE JOB TO DB ----------
      await db.jobs.add(job);

      // ---------- WRITE JOB FILE ----------
      try {
        const folder = dataset.folderHandle;
        await writeJobFile(folder, job);
      } catch (err) {
        console.warn("Failed to write job file:", err);
      }

      // ---------- UPDATE dataset.json ----------
      try {
        const folder = dataset.folderHandle;
        const meta = (await readDatasetMetadata(folder)) || {};
        meta.jobs = meta.jobs || [];
        meta.jobs.push({
          id: job.id,
          name: job.name,
          status: job.status,
          imageCount: imageIds.length,
          createdAt: job.createdAt,
        });

        await writeDatasetMetadata(folder, meta);
      } catch (err) {
        console.warn("Failed to update dataset.json:", err);
      }

      // ---------- CLEAN TEMP IMAGES ----------
      for (const id of imageIds) await db.tempImages.delete(id);

      setImages((p) => p.filter((i) => !imageIds.includes(i.id)));
      setSelected(new Set());

      openModal({
        type: "success",
        title: "Job Created",
        message: "Job created successfully."
      });

      onJobCreated?.();
    } catch (err) {
      openModal({
        type: "error",
        title: "Error",
        message: err.message,
      });
    } finally {
      setLoading(false);
      setStatusText("");
    }
  };

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      style={{
        border: dragActive ? "2px dashed #4f46e5" : "2px dashed #aaa",
        padding: "2rem",
        borderRadius: 12,
        position: "relative",
        background: themeColors.background,
      }}
    >
      <AppModal {...modal} show={modal.show} onClose={closeModal} />

      <VideoImportModal
        show={showVideoModal}
        onHide={() => setShowVideoModal(false)}
        file={videoFile}
        onExtractComplete={handleVideoExtractComplete}
      />

      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "#00000033",
            zIndex: 20,
          }}
        >
          <Spinner animation="border" />
          <div style={{ marginTop: 10 }}>{statusText}</div>
        </div>
      )}

      <div className="text-center mb-4">
        <h5><UploadCloud size={20} /> Upload Images or Video</h5>
        <Form.Control type="file" multiple accept="image/*,video/*"
          onChange={(e) => handleFiles(e.target.files)} />
      </div>

      {images.length > 0 && (
        <div
          className="d-flex justify-content-between align-items-center mb-3"
          style={{
            background: themeColors.toolbarBg,
            padding: "0.75rem",
            borderRadius: 8,
          }}
        >
          <div><b>Total:</b> {images.length}</div>
          <div><b>Selected:</b> {selected.size}</div>

          <div className="d-flex gap-2">
            <Button size="sm" onClick={selectAll}>Select All</Button>
            <Button size="sm" onClick={clearSelection}>Clear</Button>
            <Button size="sm" variant="danger" onClick={deleteSelected}>Delete</Button>
            <Button size="sm" variant="primary" onClick={createJob}>Create Job</Button>
          </div>
        </div>
      )}

      <Row xs={2} sm={3} md={4} lg={5} className="g-3">
        {images.map((img) => (
          <Col key={img.id}>
            <Card
              onClick={() => toggleSelect(img.id)}
              style={{
                cursor: "pointer",
                border: selected.has(img.id)
                  ? `2px solid ${themeColors.primary}`
                  : `1px solid ${themeColors.border}`,
              }}
            >
              <div style={{ height: 130, overflow: "hidden" }}>
                <img
                  src={img.url}
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                  onError={(e) => {
                    if (img.blob) {
                      const newUrl = URL.createObjectURL(img.blob);
                      e.target.src = newUrl;
                      createdUrlsRef.current.add(newUrl);
                    }
                  }}
                />
              </div>

              <Card.Body className="p-2 text-center">
                <div>{img.originalName}</div>

                {selected.has(img.id)
                  ? <CheckSquare color={themeColors.primary} />
                  : <Square color={themeColors.text} />}
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
