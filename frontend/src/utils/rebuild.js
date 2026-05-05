// src/utils/rebuild.js
// Rebuilds IndexedDB from filesystem project folder
import { db } from "./db";
import {
  readProjectMetadata,
  readDatasetMetadata,
} from "./fs";

/**
 * 🔥 MAIN ENTRY POINT
 * It is called from ProjectsPage when user selects a project folder
 *
 * await rebuildDatabaseFromProject(projectFolderHandle);
 */
export async function rebuildDatabaseFromProject(projectFolderHandle) {
  console.log("🔄 Rebuilding Dexie database from filesystem...");

  if (!projectFolderHandle) throw new Error("projectFolderHandle missing");

  // -------- Step 1: Read project metadata --------
  const projectMeta = await readProjectMetadata(projectFolderHandle);
  if (!projectMeta) throw new Error("hexlabel.project.json not found");
  
  const projectId = projectMeta.id || projectFolderHandle.name;

  // clear ONLY data for this specific project
  await clearProjectData(projectId);

  const projectRecord = {
    id: projectId,
    name: projectMeta.name || projectFolderHandle.name,
    description: projectMeta.description || "",
    folderHandle: projectFolderHandle,
    coverImage: projectMeta.coverImage || null,
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
 * Deletes all dataset/project/job/image records for a SPECIFIC project before rebuilding
 */
async function clearProjectData(projectId) {
  await db.transaction("rw", db.projects, db.datasets, db.jobs, db.images, db.annotations, db.tempImages, db.datasetVersions, async () => {
    const datasets = await db.datasets.where("projectId").equals(projectId).toArray();
    const datasetIds = datasets.map(d => d.id);

    await db.datasets.where("projectId").equals(projectId).delete();

    for (const dsId of datasetIds) {
      await db.jobs.where("datasetId").equals(dsId).delete();
      await db.images.where("datasetId").equals(dsId).delete();
      await db.annotations.where("datasetId").equals(dsId).delete();
      await db.tempImages.where("datasetId").equals(dsId).delete();
      await db.datasetVersions.where("datasetId").equals(dsId).delete();
    }
  });
  console.log(`🧹 Cleared old Dexie data for project: ${projectId}`);
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
    coverImage: datasetMeta.coverImage || null,
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
        id: entry.name.includes(".") ? entry.name.substring(0, entry.name.lastIndexOf('.')) : entry.name, // Extract base safely
        datasetId,
        name: entry.name,
        originalName: file.name,
        path: `images/raw/${entry.name}`,
        createdAt: new Date().toISOString(),
        jobId: null, // updated later
        url: URL.createObjectURL(file),
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
