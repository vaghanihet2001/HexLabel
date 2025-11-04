import React, { useEffect, useState } from "react";
import { Card, Button, Spinner } from "react-bootstrap";
import { db } from "../../utils/db";
import { useNavigate, useParams } from "react-router-dom";
import { useTheme } from "../../components/ThemeContext";
import { Trash2, Play, CheckCircle, PauseCircle } from "lucide-react";

export default function AnnotationTasksPage({ datasetId, jobRefresh }) {
  const { themeColors } = useTheme();
  const navigate = useNavigate();
  const { projectId } = useParams();

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  // 🔁 Load jobs when datasetId or jobRefresh changes
  useEffect(() => {
    const loadJobs = async () => {
      setLoading(true);
      try {
        const all = await db.jobs?.where("datasetId").equals(datasetId).toArray();
        setJobs(all || []);
      } finally {
        setLoading(false);
      }
    };
    loadJobs();
  }, [datasetId, jobRefresh]);

  // 🔄 Update job status
  const updateJobStatus = async (id, newStatus) => {
    await db.jobs.update(id, { status: newStatus });
    setJobs((prev) =>
      prev.map((job) => (job.id === id ? { ...job, status: newStatus } : job))
    );
  };

  // 🖼 Attach jobId to images when job starts (if not already)
  const attachImagesToJob = async (job) => {
    try {
      // Get all images by datasetId
      const datasetImages = await db.images
        .where("datasetId")
        .equals(job.datasetId)
        .toArray();

      // Filter only images belonging to this job (imageIds)
      const jobImages = datasetImages.filter((img) =>
        job.imageIds.includes(img.id)
      );

      // Update them to include jobId (if not already set)
      await Promise.all(
        jobImages.map((img) =>
          db.images.update(img.id, { jobId: job.id }).catch(() => {})
        )
      );

      console.log(`✅ Linked ${jobImages.length} images to job ${job.id}`);
    } catch (err) {
      console.error("❌ Failed to attach images to job:", err);
    }
  };

  // ❌ Delete job
  const deleteJob = async (id) => {
    if (!confirm("Delete this job?")) return;
    await db.jobs.delete(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  // 🧱 Single Job Card
  const JobCard = ({ job }) => (
    <Card
      className="mb-3 shadow-sm"
      style={{
        backgroundColor: themeColors.cardBg,
        color: themeColors.text,
        border: `1px solid ${themeColors.border}`,
      }}
    >
      <Card.Body>
        <Card.Title>{job.name}</Card.Title>
        <Card.Subtitle
          className="mb-2"
          style={{ fontSize: "0.85rem", color: themeColors.subtleText }}
        >
          {new Date(job.createdAt).toLocaleString()}
        </Card.Subtitle>
        <p style={{ fontSize: "0.85rem" }}>Images: {job.imageIds?.length || 0}</p>

        <div className="d-flex gap-2 flex-wrap">
          {/* 🟢 Not Started */}
          {job.status === "not_started" && (
            <Button
              size="sm"
              variant="success"
              onClick={async () => {
                await updateJobStatus(job.id, "in_progress");
                await attachImagesToJob(job);
                navigate(`/annotate/${projectId}/${datasetId}/${job.id}`);
              }}
            >
              <Play size={14} className="me-1" /> Start
            </Button>
          )}

          {/* 🟡 In Progress */}
          {job.status === "in_progress" && (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => navigate(`/annotate/${projectId}/${datasetId}/${job.id}`)}
              >
                <PauseCircle size={14} className="me-1" /> Resume
              </Button>
              <Button
                size="sm"
                variant="outline-success"
                onClick={() => updateJobStatus(job.id, "completed")}
              >
                <CheckCircle size={14} className="me-1" /> Mark Complete
              </Button>
            </>
          )}

          {/* ✅ Completed */}
          {job.status === "completed" && (
            <Button
              size="sm"
              variant="outline-success"
              onClick={() => navigate(`/annotate/${projectId}/${datasetId}/${job.id}`)}
            >
              View
            </Button>
          )}

          {/* ❌ Delete */}
          <Button
            size="sm"
            variant="outline-danger"
            onClick={() => deleteJob(job.id)}
          >
            <Trash2 size={14} className="me-1" /> Delete
          </Button>
        </div>
      </Card.Body>
    </Card>
  );

  // 🗂 Section Layout
  const Section = ({ title, jobs }) => (
    <div style={{ flex: 1, minWidth: "300px" }}>
      <h5
        style={{
          borderBottom: `2px solid ${themeColors.primary}`,
          color: themeColors.text,
          paddingBottom: "0.5rem",
        }}
      >
        {title}
      </h5>
      {jobs.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: "1rem" }}>No jobs here.</p>
      ) : (
        jobs.map((job) => <JobCard key={job.id} job={job} />)
      )}
    </div>
  );

  // ⏳ Loader
  if (loading)
    return (
      <div
        style={{
          height: "60vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Spinner animation="border" role="status" />
      </div>
    );

  // 🧩 Group jobs by status
  const notStarted = jobs.filter((j) => j.status === "not_started");
  const inProgress = jobs.filter((j) => j.status === "in_progress");
  const completed = jobs.filter((j) => j.status === "completed");

  // 🎨 Render layout
  return (
    <div
      className="d-flex flex-wrap gap-4"
      style={{
        minHeight: "70vh",
        backgroundColor: themeColors.background,
        padding: "1rem",
        borderRadius: 12,
      }}
    >
      <Section title="🕓 Not Started" jobs={notStarted} />
      <Section title="🚧 In Progress" jobs={inProgress} />
      <Section title="✅ Completed" jobs={completed} />
    </div>
  );
}
