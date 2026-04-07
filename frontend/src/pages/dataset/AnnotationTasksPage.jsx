// frontend/src/pages/dataset/AnnotationTasksPage.jsx
import React, { useEffect, useState } from "react";
import { Card, Button, Spinner } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../../components/ThemeContext";
import AppModal from "../../components/AppModal";

import { Trash2, Play, CheckCircle, PauseCircle } from "lucide-react";

import { db } from "../../utils/db";
import {
  readDatasetMetadata,
  writeDatasetMetadata,
  writeJobFile,
  deleteJobFile,
  readJobFile,
} from "../../utils/fs";

export default function AnnotationTasksPage({ project, dataset, jobRefresh }) {
  const datasetId = dataset?.id;
  const projectId = project?.id;
  const { themeColors } = useTheme();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const openModal = (d) => setModal({ ...modal, ...d, show: true });
  const closeModal = () => setModal({ ...modal, show: false, onConfirm: null });

  // Get dataset folder
  const getDatasetFolder = async () => {
    if (dataset.folderHandle) return dataset.folderHandle;
    if (project.folderHandle) {
      return await project.folderHandle.getDirectoryHandle(dataset.name);
    }
    return null;
  };

  // ------------------------------
  // LOAD JOBS
  // ------------------------------
  useEffect(() => {
    if (!datasetId) return;
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        // --- Step 1: Sync jobs from filesystem into IndexedDB ---
        // This ensures jobs are visible even after re-opening the project
        // from disk without a full rebuild (e.g. just refreshing the page).
        try {
          const folder = await getDatasetFolder();
          if (folder) {
            const jobsFolder = await folder.getDirectoryHandle("jobs").catch(() => null);
            if (jobsFolder) {
              for await (const entry of jobsFolder.values()) {
                if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
                try {
                  const fh = await jobsFolder.getFileHandle(entry.name);
                  const file = await fh.getFile();
                  const job = JSON.parse(await file.text());
                  if (!job?.id) continue;

                  // Only upsert if not already in DB (avoid overwriting in-memory status)
                  const existing = await db.jobs.get(job.id);
                  if (!existing) {
                    await db.jobs.put({
                      id: job.id,
                      name: job.name,
                      datasetId,
                      status: job.status || "not_started",
                      createdAt: job.createdAt,
                      imageIds: job.imageIds || [],
                    });
                  }
                } catch (e) {
                  console.warn("Failed to parse job file:", entry.name, e);
                }
              }
            }
          }
        } catch (syncErr) {
          console.warn("FS job sync failed:", syncErr);
        }

        // --- Step 2: Load from DB ---
        const list = await db.jobs.where("datasetId").equals(datasetId).toArray();

        // Attach dynamic image counts
        for (const job of list) {
          job.imageCount = await db.images.where("jobId").equals(job.id).count();
        }

        if (mounted) setJobs(list);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => (mounted = false);
  }, [datasetId, jobRefresh]);

  // ------------------------------
  // UPDATE DATASET METADATA.JSON
  // ------------------------------
  const updateMetadataJobEntry = async (jobId, patch) => {
    try {
      const folder = await getDatasetFolder();
      if (!folder) return;

      const meta = (await readDatasetMetadata(folder)) || {};
      meta.jobs = meta.jobs || [];

      const idx = meta.jobs.findIndex((j) => j.id === jobId);
      if (idx !== -1) {
        meta.jobs[idx] = { ...meta.jobs[idx], ...patch };
      }

      await writeDatasetMetadata(folder, meta);
    } catch (err) {
      console.error("Failed to update dataset metadata:", err);
    }
  };

  // ------------------------------
  // UPDATE JOB STATUS + JOB FILE
  // ------------------------------
  const updateJobStatus = async (job, status) => {
    await db.jobs.update(job.id, { status });

    // update metadata.json
    await updateMetadataJobEntry(job.id, { status });

    // update job file
    try {
      const folder = await getDatasetFolder();
      if (folder) {
        const updatedJob = { ...job, status };
        await writeJobFile(folder, updatedJob);
      }
    } catch (err) {
      console.error("Failed to update job file:", err);
    }

    // update UI
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, status } : j))
    );
  };

  // ------------------------------
  // ATTACH IMAGES TO JOB
  // ------------------------------
  const attachImages = async (job) => {
    const imgs = await db.images.where("datasetId").equals(datasetId).toArray();
    const needed = imgs.filter((i) => job.imageIds.includes(i.id));
    for (const img of needed) {
      await db.images.update(img.id, { jobId: job.id });
    }
  };

  // ------------------------------
  // DELETE JOB + DELETE JOB FILE
  // ------------------------------
  const askDeleteJob = (job) => {
    openModal({
      type: "confirm",
      title: "Delete Job?",
      message: `Delete "${job.name}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        try {
          // Unassign images
          await db.images.where("jobId").equals(job.id).modify({ jobId: null });

          // Delete job from DB
          await db.jobs.delete(job.id);

          const folder = await getDatasetFolder();

          // Remove from dataset.json
          if (folder) {
            const meta = (await readDatasetMetadata(folder)) || {};
            meta.jobs = (meta.jobs || []).filter((j) => j.id !== job.id);
            await writeDatasetMetadata(folder, meta);

            // Delete job file
            try {
              await deleteJobFile(folder, job.id);
            } catch (err) {
              console.warn("Failed to delete job file:", err);
            }
          }

          // Update UI
          setJobs((prev) => prev.filter((j) => j.id !== job.id));

          return true;
        } catch (err) {
          console.error("Delete job failed:", err);
          openModal({
            type: "error",
            title: "Error",
            message: "Failed to delete job.",
          });
          return false;
        }
      },
      autoClose: true,
    });
  };

  // ------------------------------
  // START JOB
  // ------------------------------
  const startJob = async (job) => {
    await updateJobStatus(job, "in_progress");
    await attachImages(job);

    // Navigate to annotation UI
    navigate(`/annotate/${projectId}/${datasetId}/${job.id}`);
  };

  // ------------------------------
  // MARK COMPLETE
  // ------------------------------
  const markComplete = (job) => {
    openModal({
      type: "confirm",
      title: "Complete?",
      message: `Mark "${job.name}" as completed?`,
      confirmText: "Complete",
      cancelText: "Cancel",
      onConfirm: async () => {
        await updateJobStatus(job, "completed");
        return true;
      },
      autoClose: true,
    });
  };

  // ------------------------------
  // JOB CARD COMPONENT
  // ------------------------------
  const JobCard = ({ job }) => (
    <Card
      className="mb-3 shadow-sm"
      style={{
        background: themeColors.cardBg,
        color: themeColors.text,
        border: `1px solid ${themeColors.border}`,
      }}
    >
      <Card.Body>
        <Card.Title>{job.name}</Card.Title>
        <Card.Subtitle className="mb-2" style={{ color: themeColors.subtleText }}>
          {new Date(job.createdAt).toLocaleString()}
        </Card.Subtitle>

        <p>Images: {job.imageCount}</p>

        <div className="d-flex gap-2 flex-wrap">
          {/* Start */}
          {job.status === "not_started" && (
            <Button size="sm" variant="success" onClick={() => startJob(job)}>
              <Play size={14} /> Start
            </Button>
          )}

          {/* In progress */}
          {job.status === "in_progress" && (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  navigate(`/annotate/${projectId}/${datasetId}/${job.id}`)
                }
              >
                <PauseCircle size={14} /> Resume
              </Button>
              <Button
                size="sm"
                variant="outline-success"
                onClick={() => markComplete(job)}
              >
                <CheckCircle size={14} /> Complete
              </Button>
            </>
          )}

          {/* Completed */}
          {job.status === "completed" && (
            <Button
              size="sm"
              variant="outline-success"
              onClick={() =>
                navigate(`/annotate/${projectId}/${datasetId}/${job.id}`)
              }
            >
              View
            </Button>
          )}

          {/* Delete */}
          <Button
            size="sm"
            variant="outline-danger"
            onClick={() => askDeleteJob(job)}
          >
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      </Card.Body>
    </Card>
  );

  // ------------------------------
  // LOADING UI
  // ------------------------------
  if (loading)
    return (
      <div style={{ height: "60vh", display: "flex", justifyContent: "center", alignItems: "center" }}>
        <Spinner animation="border" />
      </div>
    );

  const notStarted = jobs.filter((j) => j.status === "not_started");
  const inProgress = jobs.filter((j) => j.status === "in_progress");
  const completed = jobs.filter((j) => j.status === "completed");

  return (
    <div
      className="d-flex flex-wrap gap-4"
      style={{
        padding: "1rem",
        background: themeColors.background,
      }}
    >
      <AppModal {...modal} show={modal.show} onClose={closeModal} />

      {/* Not Started */}
      <div style={{ flex: 1, minWidth: 300 }}>
        <h5 style={{ borderBottom: `2px solid ${themeColors.primary}` }}>🕓 Not Started</h5>
        {notStarted.length === 0 ? (
          <p>No jobs</p>
        ) : (
          notStarted.map((job) => <JobCard key={job.id} job={job} />)
        )}
      </div>

      {/* In Progress */}
      <div style={{ flex: 1, minWidth: 300 }}>
        <h5 style={{ borderBottom: `2px solid ${themeColors.primary}` }}>🚧 In Progress</h5>
        {inProgress.length === 0 ? (
          <p>No jobs</p>
        ) : (
          inProgress.map((job) => <JobCard key={job.id} job={job} />)
        )}
      </div>

      {/* Completed */}
      <div style={{ flex: 1, minWidth: 300 }}>
        <h5 style={{ borderBottom: `2px solid ${themeColors.primary}` }}>✅ Completed</h5>
        {completed.length === 0 ? (
          <p>No jobs</p>
        ) : (
          completed.map((job) => <JobCard key={job.id} job={job} />)
        )}
      </div>
    </div>
  );
}
