import Dexie from "dexie";

export const db = new Dexie("HexLabelDB");

/*
###########################################################
#  NEW VERSION 11 — SAFE FORWARD-COMPATIBLE SCHEMA
#  Fixes: Dexie SchemaError (jobId not indexed)
#  Adds: jobId index (required by AnnotationTasksPage)
#  Does NOT break existing DB data (pure additive index)
###########################################################
*/

db.version(11).stores({
  projects: "id, name, description, createdAt",

  datasets: "id, name, description, type, projectId, createdAt",

  datasetVersions: "id, datasetId, versionName, createdAt",

  annotations: "id, datasetId, imageId, versionId",

  // jobs stay the same
  jobs: "id, datasetId, name, status, createdAt",

  /*
  --------------------------------------------------------
  FIXED: images table MUST index jobId
  Otherwise queries like:
      db.images.where("jobId")
  will throw Dexie SchemaError
  --------------------------------------------------------
  */
  images: "id, datasetId, jobId, name, createdAt",

  tempImages: "id, datasetId, name, createdAt",
});

/*
###########################################################
#  mapToClass definitions
#  (unchanged; these do NOT affect indexes)
###########################################################
*/

// Complex objects
db.projects.mapToClass(
  class {
    folderHandle;
  }
);

db.datasets.mapToClass(
  class {
    folderHandle;
  }
);

db.images.mapToClass(
  class {
    jobId;
    url;
  }
);

db.jobs.mapToClass(
  class {
    imageIds;
  }
);

db.annotations.mapToClass(
  class {
    data;
  }
);

db.tempImages.mapToClass(
  class {
    url;
  }
);

/*
###########################################################
#  DB Init
###########################################################
*/

db.on("populate", () => {
  console.log("✅ Database initialized and ready for HexLabel");
});

// Open DB
db.open().catch((err) => {
  console.error("❌ Failed to open Dexie DB:", err);
});

/*
###########################################################
#  ID generator
###########################################################
*/

export const generateId = () => {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).substring(2, 11);
};

export default db;
