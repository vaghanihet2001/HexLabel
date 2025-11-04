import Dexie from "dexie";

// Create or upgrade the database
export const db = new Dexie("HexLabelDB");

// 🔄 Database schema upgrade to version 5
db.version(5).stores({
  projects: "++id, name, description, datasets, models, folderHandle",
  datasets: "++id, name, description, projectId, folderHandle, createdAt",
  datasetVersions: "++id, datasetId, versionName, folderHandle, createdAt",
  annotations: "++id, datasetId, imageName, versionId, data",
  // Added `jobId` field for filtering images per annotation job
  images: "++id, datasetId, jobId, name, url, uploadedAt",
  jobs: "++id, datasetId, name, imageIds, status, createdAt"
});

// 🧠 Optional: add backward-safe upgrade hook
db.on("populate", () => {
  console.log("✅ Database initialized and ready for HexLabel");
});

// ✅ Open the database safely
db.open().catch((err) => {
  console.error("❌ Failed to open Dexie DB:", err);
});

// 🚀 Export for global use
export default db;
