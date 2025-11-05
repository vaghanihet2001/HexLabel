import { db } from "./db";

// 🗑 Delete annotations belonging to an image
export async function deleteAnnotationsByImage(imageName) {
  if (!imageName) return;
  await db.annotations.where("imageName").equals(imageName).delete();
}

// 🖼 Delete image and its annotations
export async function deleteImage(imageId) {
  const image = await db.images.get(imageId);
  if (!image) return;
  await deleteAnnotationsByImage(image.name);
  await db.images.delete(imageId);
}

// ⚙️ Delete all images belonging to a job
export async function deleteImagesByJob(jobId) {
  const images = await db.images.where("jobId").equals(jobId).toArray();
  for (const img of images) await deleteAnnotationsByImage(img.name);
  await db.images.where("jobId").equals(jobId).delete();
}

// 🧩 Delete a job and its images
export async function deleteJob(jobId) {
  await deleteImagesByJob(jobId);
  await db.jobs.delete(jobId);
}

// 🧰 Delete a dataset and all associated records
export async function deleteDataset(datasetId) {
  const dataset = await db.datasets.get(datasetId);
  if (!dataset) return;

  // Delete related jobs
  const jobs = await db.jobs.where("datasetId").equals(datasetId).toArray();
  for (const job of jobs) await deleteJob(job.id);

  // Delete related entries
  await db.images.where("datasetId").equals(datasetId).delete();
  await db.tempImages.where("datasetId").equals(datasetId).delete();
  await db.annotations.where("datasetId").equals(datasetId).delete();
  await db.datasetVersions.where("datasetId").equals(datasetId).delete();

  // Try deleting from file system if possible
  try {
    if (dataset.folderHandle) {
      const parent = await dataset.folderHandle.getParent?.();
      if (parent) await parent.removeEntry(dataset.folderHandle.name, { recursive: true });
      console.log(`🗂 Folder deleted: ${dataset.folderHandle.name}`);
    }
  } catch (err) {
    console.warn("⚠️ Could not delete dataset folder:", err);
  }

  await db.datasets.delete(datasetId);
}

// 🧱 Delete project and all nested datasets
export async function deleteProject(projectId) {
  const project = await db.projects.get(projectId);
  if (!project) return;

  const datasets = await db.datasets.where("projectId").equals(projectId).toArray();
  for (const ds of datasets) await deleteDataset(ds.id);

  try {
    if (project.folderHandle) {
      await project.folderHandle.removeEntry(project.folderHandle.name, { recursive: true });
      console.log(`🧹 Folder deleted for project: ${project.name}`);
    }
  } catch (err) {
    console.warn("⚠️ Could not delete project folder:", err);
  }

  await db.projects.delete(projectId);
}

// 🧼 Delete orphaned records for cleanup
export async function cleanupOrphans() {
  console.log("🔍 Running orphan cleanup...");

  const projects = await db.projects.toArray();
  const datasets = await db.datasets.toArray();

  const validProjectIds = new Set(projects.map((p) => p.id));
  const validDatasetIds = new Set(datasets.map((d) => d.id));

  // Datasets missing their project
  const orphanDatasets = await db.datasets
    .filter((d) => !validProjectIds.has(d.projectId))
    .toArray();
  for (const d of orphanDatasets) await deleteDataset(d.id);

  // Records missing their dataset
  const tables = ["images", "annotations", "tempImages", "jobs", "datasetVersions"];
  for (const table of tables) {
    const orphans = await db[table].filter((x) => !validDatasetIds.has(x.datasetId)).toArray();
    for (const item of orphans) await db[table].delete(item.id);
  }

  console.log("✅ Orphan cleanup complete.");
}
