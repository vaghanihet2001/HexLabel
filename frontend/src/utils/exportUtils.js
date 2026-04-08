import JSZip from "jszip";
import { saveAs } from "file-saver";
import { db } from "./db";
import { readDatasetClasses } from "./fs";

/**
 * Export Formats Definition
 */
export const EXPORT_FORMATS = [
    {
        value: "yolo-cls",
        label: "YOLO Classification",
        description: "YOLO format for image classification (folder per class: train/class_name/img.jpg)."
    },
    {
        value: "yolo-hbb",
        label: "YOLO Bounding Box (HBB)",
        description: "Standard YOLO format for object detection (class xc yc w h)."
    },
    {
        value: "yolo-segment",
        label: "YOLO Segmentation (Polygon)",
        description: "YOLO format for instance segmentation (class x1 y1 x2 y2 ...)."
    }
];

/**
 * Export Registry
 */
const exporters = {
    "yolo-cls": exportYoloCls,
    "yolo-hbb": exportYoloHbb,
    "yolo-segment": exportYoloSegment,
};

/**
 * Main Export Function
 */
export async function exportDatasetVersion(version, dataset, project, format = "yolo-hbb") {
    const exporter = exporters[format];
    if (!exporter) throw new Error(`Unsupported export format: ${format}`);

    const zip = new JSZip();
    const dsId = dataset.id;
    const vId = version.id;

    // 0. Resolve dataset folder handle
    let dsHandle = dataset.folderHandle || null;
    if (!dsHandle && project?.folderHandle) {
        try {
            dsHandle = await project.folderHandle.getDirectoryHandle(dataset.name);
        } catch { /* no folder access */ }
    }

    // 1. Fetch Images (only from completed jobs, matching gallery logic)
    const completedJobs = await db.jobs.where("datasetId").equals(dsId).filter(j => j.status === "completed").toArray();
    const completedJobIds = new Set(completedJobs.map(j => j.id));

    const allImages = await db.images.where("datasetId").equals(dsId).toArray();
    const images = allImages.filter(img => completedJobIds.has(img.jobId));

    let allAnnotations = [];
    const allAnnsMap = new Map(); // deduplicate by imageId

    let imageSourceDir;
    let versionClasses;
    let versionTags;

    // 1. MUST reliably scan File System (Source of Truth) unconditionally!
    // For versions, we check the self-contained version folder first.
    if (dsHandle) {
        try {
            const annotationsDir = await dsHandle.getDirectoryHandle("annotations");
            let targetDir;
            
            try {
                // Try self-contained version folder (at dataset root)
                const versionsDir = await dsHandle.getDirectoryHandle("versions");
                const vDir = await versionsDir.getDirectoryHandle(vId);
                
                targetDir = await vDir.getDirectoryHandle("annotations");
                try {
                    const vImagesDir = await vDir.getDirectoryHandle("images");
                    imageSourceDir = await vImagesDir.getDirectoryHandle("raw");
                } catch { /* old version without images */ }

                // Overwrite classes from version metadata if present
                try {
                    const vMetadataFh = await vDir.getFileHandle("version.json");
                    const vMetadataFile = await vMetadataFh.getFile();
                    const vMetadata = JSON.parse(await vMetadataFile.text());
                    if (vMetadata.classes) versionClasses = vMetadata.classes;
                    if (vMetadata.tags) versionTags = vMetadata.tags;
                } catch { /* fallback to dataset classes */ }

            } catch (e) {
                // Fall back to active working copy
                targetDir = await annotationsDir.getDirectoryHandle("active");
                if (vId) console.warn("[export] Version folder not found, falling back to active:", vId, e);
            }

            for await (const entry of targetDir.values()) {
                if (entry.kind === "file" && entry.name.endsWith(".json")) {
                    try {
                        const file = await entry.getFile();
                        const data = JSON.parse(await file.text());
                        if (data && data.imageId) {
                            allAnnsMap.set(data.imageId, data);
                        }
                    } catch { /* skip corrupt */ }
                }
            }
        } catch { /* no annotations folder */ }
    }

    // 2. Fetch from IndexedDB and merge (handles freshly edited unsaved changes)
    // For non-version exports (active), we merge latest DB state.
    // For version exports, we ONLY check for specific versioned DB records (rare in new system).
    let dbAnnotations = await db.annotations.where("datasetId").equals(dsId)
        .filter(a => a.versionId === vId)
        .toArray();

    if (dbAnnotations.length === 0 && !vId) {
        dbAnnotations = await db.annotations.where("datasetId").equals(dsId)
            .filter(a => !a.versionId)
            .toArray();
    }

    dbAnnotations.forEach(data => {
        // DB annotations override FS since they represent the latest user edits
        if (data && data.imageId) {
            allAnnsMap.set(data.imageId, data);
        }
    });

    allAnnotations = Array.from(allAnnsMap.values());

    // Map: imageId -> annotations array
    const annMap = new Map();
    allAnnotations.forEach(rec => {
        const arr = rec.data ?? rec.annotations ?? [];
        if (arr.length > 0) {
            annMap.set(rec.imageId, arr);
        }
    });

    // 3. Load class dictionary from dataset.json (source of truth)
    // Annotations store classId (UUID); we need classId -> { name, index } mapping.
    let diskClasses = [];
    if (dsHandle) {
        try {
            diskClasses = await readDatasetClasses(dsHandle);
        } catch (e) {
            console.warn("[export] Could not read dataset classes from disk:", e);
        }
    }

    // Build sorted class list from the class dictionary.
    // Use version-locked classes if available, otherwise fall back to disk/db
    const sourceClasses = versionClasses || diskClasses;
    
    const usedClassIds = new Set();
    allAnnotations.forEach(rec => {
        const arr = rec.data ?? rec.annotations ?? [];
        arr.forEach(a => {
            if (a.classId) usedClassIds.add(a.classId);
        });
    });

    const classes = sourceClasses
        .filter(c => usedClassIds.has(c.id))
        .sort((a, b) => a.name.localeCompare(b.name));

    // If disk classes are unavailable, build a minimal list from annotation data
    if (classes.length === 0 && usedClassIds.size > 0) {
        console.warn("[export] Class dictionary unavailable; class names will be missing.");
    }

    // classId (UUID) -> YOLO class index
    const classToIndex = new Map(classes.map((c, i) => [c.id, i]));
    // classId -> className (for data.yaml)
    const classNames = classes.map(c => c.name);

    // 4. Prepare Data for Exporter
    const context = {
        zip,
        version,
        dataset,
        dsHandle,
        classes: classNames,
        classToIndex,  // keyed by classId UUID
        images,
        annMap,
        imageSourceDir,
        versionClasses,
        versionTags
    };

    // 5. Run Exporter
    await exporter(context);

    // 6. Generate Zip
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `${dataset.name}-${version.name}-${format}.zip`);
}

/**
 * YOLO HBB Exporter
 */
async function exportYoloHbb(ctx) {
    const { zip, classes } = ctx;

    // data.yaml
    const yamlContent = `train: ../train/images
val: ../val/images
test: ../test/images

nc: ${classes.length}
names: [${classes.map(c => `"${c}"`).join(", ")}]
`;
    zip.file("data.yaml", yamlContent);

    await processImages(ctx, (img, anns) => {
        const lines = [];
        for (const a of anns) {
            // Resolve by classId (UUID) — the current storage format
            const clsIdx = ctx.classToIndex.get(a.classId);
            if (clsIdx === undefined) continue;

            if (a.type === "bbox") {
                // a.points is normalized [x1, y1, x2, y2]
                // YOLO: class xc yc w h (normalized)
                const [x1, y1, x2, y2] = a.points;
                const w = Math.abs(x2 - x1);
                const h = Math.abs(y2 - y1);
                const xc = (x1 + x2) / 2;
                const yc = (y1 + y2) / 2;
                lines.push(`${clsIdx} ${xc.toFixed(6)} ${yc.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`);
            } else if (a.type === "poly" && a.points.length >= 6) {
                // Convert polygon to tight bounding box
                let minX = 1.0, maxX = 0.0, minY = 1.0, maxY = 0.0;
                for (let i = 0; i < a.points.length; i += 2) {
                    const x = a.points[i];
                    const y = a.points[i + 1];
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
                const w = Math.abs(maxX - minX);
                const h = Math.abs(maxY - minY);
                const xc = (minX + maxX) / 2;
                const yc = (minY + maxY) / 2;
                lines.push(`${clsIdx} ${xc.toFixed(6)} ${yc.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`);
            }
        }
        return lines;
    });
}

/**
 * YOLO Segment Exporter
 */
async function exportYoloSegment(ctx) {
    const { zip, classes } = ctx;

    // data.yaml
    const yamlContent = `train: ../train/images
val: ../val/images
test: ../test/images

nc: ${classes.length}
names: [${classes.map(c => `"${c}"`).join(", ")}]
`;
    zip.file("data.yaml", yamlContent);

    await processImages(ctx, (img, anns) => {
        const lines = [];
        for (const a of anns) {
            // Resolve by classId (UUID) — the current storage format
            const clsIdx = ctx.classToIndex.get(a.classId);
            if (clsIdx === undefined) continue;

            if (a.type === "poly") {
                // a.points is flattened [x1, y1, x2, y2, ...] normalized
                const points = a.points.map(p => p.toFixed(6)).join(" ");
                lines.push(`${clsIdx} ${points}`);
            } else if (a.type === "bbox" && a.points.length === 4) {
                // Convert BBox [x1, y1, x2, y2] to Polygon [x1,y1, x2,y1, x2,y2, x1,y2]
                const x1 = Math.min(a.points[0], a.points[2]);
                const x2 = Math.max(a.points[0], a.points[2]);
                const y1 = Math.min(a.points[1], a.points[3]);
                const y2 = Math.max(a.points[1], a.points[3]);

                const pts = [x1, y1, x2, y1, x2, y2, x1, y2];
                const points = pts.map(p => p.toFixed(6)).join(" ");
                lines.push(`${clsIdx} ${points}`);
            }
        }
        return lines;
    });
}

/**
 * Helper: Process Images & Splits
 */
async function processImages(ctx, formatAnnotationFn) {
    const { zip, images, version, annMap, dataset, dsHandle } = ctx;

    const folders = {
        train: { images: zip.folder("train").folder("images"), labels: zip.folder("train").folder("labels") },
        val: { images: zip.folder("val").folder("images"), labels: zip.folder("val").folder("labels") },
        test: { images: zip.folder("test").folder("images"), labels: zip.folder("test").folder("labels") },
    };

    const shuffled = [...images].sort(() => Math.random() - 0.5);
    const total = shuffled.length;
    const nTrain = Math.floor(total * (version.splits.train / 100));
    const nVal = Math.floor(total * (version.splits.val / 100));

    for (let i = 0; i < total; i++) {
        const img = shuffled[i];
        let split = "train";
        if (i >= nTrain && i < nTrain + nVal) split = "val";
        else if (i >= nTrain + nVal) split = "test";

        const target = folders[split];

        // Get Image Blob
        let blob = null;
        if (img.file instanceof Blob) {
            blob = img.file;
        } else if (ctx.imageSourceDir) {
            try {
                const fh = await ctx.imageSourceDir.getFileHandle(img.name);
                blob = await fh.getFile();
            } catch (e) {
                console.warn("[export] Missing image in version folder:", img.name);
            }
        } else if (dsHandle) {
            try {
                const imagesDir = await dsHandle.getDirectoryHandle("images");
                const rawDir = await imagesDir.getDirectoryHandle("raw");
                const fh = await rawDir.getFileHandle(img.name);
                blob = await fh.getFile();
            } catch (e) {
                console.warn("[export] Missing image file in root raw folder:", img.name);
            }
        }

        if (blob) {
            target.images.file(img.name, blob);

            // Generate Label File
            // ALWAYS generate a label file, even if empty (for YOLO)
            const anns = annMap.get(img.id) || [];
            let lines = [];

            // We only need dimensions if we are doing some pixel-based calc, 
            // but here points are already normalized.
            // However, if we needed to normalize, we'd need dims.
            // Assuming points are normalized as per app standard.

            lines = formatAnnotationFn(img, anns, 0, 0); // width/height ignored if normalized

            // Create .txt file
            const txtName = img.name.replace(/\.[^/.]+$/, "") + ".txt";
            target.labels.file(txtName, lines.join("\n"));
        }
    }
}

// Backward compatibility wrapper if needed, or just replace usage
export const exportVersionToYolo = (v, d, p) => exportDatasetVersion(v, d, p, "yolo-hbb");

/**
 * YOLO Classification Exporter (Folder-based structure)
 */
async function exportYoloCls(ctx) {
    const { zip, images, version, annMap, dsHandle } = ctx;

    const shuffled = [...images].sort(() => Math.random() - 0.5);
    const total = shuffled.length;
    
    let nTrain = Math.floor(total * (version.splits.train / 100));
    let nVal = Math.floor(total * (version.splits.val / 100));
    
    // Fix remainder spillage into 'test' if test is set to 0%
    if (version.splits.test === 0 || !version.splits.test) {
        if (total - nTrain - nVal > 0) {
            nTrain += (total - nTrain - nVal); // dump remaining into train
        }
    }
    const nTest = total - nTrain - nVal;

    // Pre-create all folders for all classes so YOLO-CLS doesn't break if a class is unrepresented in a split
    const activeSplits = [];
    if (nTrain > 0) activeSplits.push("train");
    if (nVal > 0) activeSplits.push("val");
    if (nTest > 0) activeSplits.push("test");

    const allClassNames = [...ctx.classes];
    activeSplits.forEach(split => {
        allClassNames.forEach(cls => {
            zip.folder(split).folder(cls);
        });
    });

    for (let i = 0; i < total; i++) {
        const img = shuffled[i];
        let split = "train";
        if (i < nTrain) split = "train";
        else if (i < nTrain + nVal) split = "val";
        else split = "test";

        const anns = annMap.get(img.id) || [];
        const classAnns = anns.filter(a => a.type === "class");
        
        if (classAnns.length === 0 || !classAnns[0].classId) {
            continue; // Skip images with no classification label
        }

        let className = "unclassified";
        const classId = classAnns[0].classId;
        const clsIdx = ctx.classToIndex.get(classId);
        if (clsIdx !== undefined && ctx.classes[clsIdx]) {
            className = ctx.classes[clsIdx];
        } else if (classAnns[0].name) {
            className = classAnns[0].name;
        } else {
            continue; // Skip if class metadata is entirely lost
        }

        const targetFolder = zip.folder(split).folder(className);

        let blob = null;
        if (img.file instanceof Blob) {
            blob = img.file;
        } else if (ctx.imageSourceDir) {
            try {
                const fh = await ctx.imageSourceDir.getFileHandle(img.name);
                blob = await fh.getFile();
            } catch (e) {
                console.warn("[export] Missing image in version folder:", img.name);
            }
        } else if (dsHandle) {
            try {
                const imagesDir = await dsHandle.getDirectoryHandle("images");
                const rawDir = await imagesDir.getDirectoryHandle("raw");
                const fh = await rawDir.getFileHandle(img.name);
                blob = await fh.getFile();
            } catch (e) {
                console.warn("[export] Missing image file in root raw folder:", img.name);
            }
        }

        if (blob) {
            targetFolder.file(img.name, blob);
        }
    }
}
