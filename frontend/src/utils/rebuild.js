// src/utils/rebuild.js
// Rebuilds IndexedDB from filesystem project folder
import { db } from "./db";
import {
  readProjectMetadata,
  readDatasetMetadata,
} from "./fs";

/**
 * 🔥 MAIN ENTRY POINT
 * Call this from ProjectsPage when user selects a project folder
 *
 * await rebuildDatabaseFromProject(projectFolderHandle);
 */
export async function rebuildDatabaseFromProject(projectFolderHandle) {
  console.log("🔄 Rebuilding Dexie database from filesystem...");

  if (!projectFolderHandle) throw new Error("projectFolderHandle missing");

  // clear ONLY project-related tables
  await clearProjectTables();

  // -------- Step 1: Read project metadata --------
  const projectMeta = await readProjectMetadata(projectFolderHandle);
  if (!projectMeta) throw new Error("hexlabel.project.json not found");

  const projectRecord = {
    id: projectMeta.id || projectFolderHandle.name,
    name: projectMeta.name || projectFolderHandle.name,
    description: projectMeta.description || "",
    folderHandle: projectFolderHandle,
    createdAt: projectMeta.createdAt || new Date().toISOString(),
  };

  await db.projects.put(projectRecord);

  // -------- Step 2: Scan datasets --------
  const datasets = projectMeta.datasets || [];

  for (const ds of datasets) {
    const dsFolder = await projectFolderHandle.getDirectoryHandle(ds.name).catch(() => null);
    if (!dsFolder) continue;

    await rebuildDataset(dsFolder, projectRecord.id);
  }

  console.log("✅ Rebuild complete.");
  return true;
}

/**
 * Deletes all dataset/project/job/image records before rebuilding
 */
async function clearProjectTables() {
  await db.transaction("rw", db.projects, db.datasets, db.jobs, db.images, db.annotations, db.tempImages, db.datasetVersions, async () => {
    await db.projects.clear();
    await db.datasets.clear();
    await db.jobs.clear();
    await db.images.clear();
    await db.annotations.clear();
    await db.tempImages.clear();
    await db.datasetVersions.clear();
  });
  console.log("🧹 Cleared Dexie tables.");
}

/**
 * Rebuild a dataset from its folder structure
 */
async function rebuildDataset(datasetFolderHandle, projectId) {
  const datasetMeta = await readDatasetMetadata(datasetFolderHandle);
  if (!datasetMeta) {
    console.warn("⚠ Missing dataset.json for:", datasetFolderHandle.name);
    return;
  }

  const datasetId = datasetMeta.id || datasetFolderHandle.name;

  const dsRecord = {
    id: datasetId,
    name: datasetMeta.name,
    description: datasetMeta.description || "",
    type: datasetMeta.type || "detect",
    projectId,
    folderHandle: datasetFolderHandle,
    createdAt: datasetMeta.createdAt || new Date().toISOString(),
  };

  await db.datasets.put(dsRecord);

  // --- Step 1: Rebuild images ---
  await rebuildImages(datasetFolderHandle, datasetId);

  // --- Step 2: Rebuild jobs ---
  await rebuildJobs(datasetFolderHandle, datasetId);

  console.log(`📁 Dataset rebuilt: ${datasetMeta.name}`);
}

/**
 * Reads /images/raw/ folder and rebuilds db.images
 */
async function rebuildImages(datasetFolder, datasetId) {
  try {
    const imagesFolder = await datasetFolder.getDirectoryHandle("images");
    const rawFolder = await imagesFolder.getDirectoryHandle("raw");

    for await (const entry of rawFolder.values()) {
      if (entry.kind !== "file") continue;

      const file = await entry.getFile();

      await db.images.put({
        id: entry.name.split(".")[0], // jobId format = UUID.ext → extract base
        datasetId,
        name: entry.name,
        originalName: file.name,
        path: `images/raw/${entry.name}`,
        createdAt: new Date().toISOString(),
        jobId: null, // updated later
      });
    }

    console.log("🖼 Rebuilt images for dataset:", datasetId);
  } catch (err) {
    console.warn("No images found for dataset:", datasetId);
  }
}

/**
 * Reads /jobs/*.json and rebuilds db.jobs + image.jobId links
 */
async function rebuildJobs(datasetFolder, datasetId) {
  let jobsFolder;
  try {
    jobsFolder = await datasetFolder.getDirectoryHandle("jobs");
  } catch {
    console.warn("No jobs folder for dataset", datasetId);
    return;
  }

  for await (const entry of jobsFolder.values()) {
    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;

    const fh = await jobsFolder.getFileHandle(entry.name);
    const file = await fh.getFile();
    const job = JSON.parse(await file.text());

    // Save job into Dexie
    await db.jobs.put({
      id: job.id,
      name: job.name,
      datasetId,
      status: job.status || "not_started",
      createdAt: job.createdAt,
      imageIds: job.imageIds || [],
    });

    // Update images.jobId
    if (job.imageIds?.length) {
      for (const imgId of job.imageIds) {
        await db.images.update(imgId, { jobId: job.id });
      }
    }
  }

  console.log("🧩 Rebuilt jobs for dataset:", datasetId);
}
