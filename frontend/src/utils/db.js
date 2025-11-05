import Dexie from "dexie";

// Create or upgrade the database
export const db = new Dexie("HexLabelDB");

// ✅ Database schema (string IDs)
db.version(9).stores({
  projects: "id, name, description, datasets, models, folderHandle",
  datasets: "id, name, description, projectId, folderHandle, createdAt",
  datasetVersions: "id, datasetId, versionName, folderHandle, createdAt",
  annotations: "id, datasetId, imageName, versionId, data",
  jobs: "id, datasetId, name, imageIds, status, createdAt",
  images: "id, datasetId, jobId, name, url, uploadedAt",
  tempImages: "id, datasetId, name, url, uploadedAt",
});

db.on("populate", () => {
  console.log("✅ Database initialized and ready for HexLabel");
});

db.open().catch((err) => {
  console.error("❌ Failed to open Dexie DB:", err);
});

// ✅ ID generator
export const generateId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "id-" + Math.random().toString(36).substring(2, 11);
};

export default db;
