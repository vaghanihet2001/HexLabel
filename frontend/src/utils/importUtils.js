import { db, generateId } from "./db";
import { 
    createDatasetFolderStructure, 
    addDatasetToProjectMeta,
    writeImageMeta
} from "./fs";

/**
 * IMPORT_FORMATS
 * Extensible registry of supported formats.
 */
export const IMPORT_FORMATS = [
    { value: "yolo-hbb", label: "YOLO Bounding Box (HBB)", type: "detect" },
    { value: "yolo-segment", label: "YOLO Segmentation", type: "segment" },
    { value: "yolo-obb", label: "YOLO Oriented Bounding Box (OBB)", type: "obb" },
    { value: "yolo-cls", label: "YOLO Classification", type: "classify" },
    // { value: "coco", label: "COCO Format", type: "detect" } // Future extension
];

const colorForLabel = (label) => {
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h << 5) - h + label.charCodeAt(i);
    return `hsl(${Math.abs(h) % 360} 70% 50%)`;
};

/**
 * Helper: Recursively find files by extension
 */
async function findFilesRecursively(dirHandle, extensions, path = "") {
    let files = [];
    for await (const entry of dirHandle.values()) {
        if (entry.kind === "file") {
            const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
            if (extensions.includes(ext)) {
                files.push({ handle: entry, name: entry.name, path: `${path}${entry.name}` });
            }
        } else if (entry.kind === "directory") {
            try {
                const subDir = await dirHandle.getDirectoryHandle(entry.name);
                files = files.concat(await findFilesRecursively(subDir, extensions, `${path}${entry.name}/`));
            } catch (e) {
                // Ignore inaccessible folders
            }
        }
    }
    return files;
}

/**
 * Helper: Write annotation file directly to /annotations/active/
 */
async function writeActiveAnnotationFile(datasetHandle, imageId, payload) {
    const annotationsHandle = await datasetHandle.getDirectoryHandle("annotations", { create: true });
    const activeHandle = await annotationsHandle.getDirectoryHandle("active", { create: true });
    const fh = await activeHandle.getFileHandle(`${imageId}.json`, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(payload, null, 2));
    await w.close();
}

/**
 * Main Entry Point
 */
export async function importDataset(projectHandle, importDirHandle, meta, format, onProgress) {
    const formatInfo = IMPORT_FORMATS.find(f => f.value === format);
    if (!formatInfo) throw new Error("Unsupported format");

    // Pre-scan structure
    onProgress?.({ stage: "Scanning files...", current: 0, total: 100 });
    
    const allFiles = await findFilesRecursively(importDirHandle, [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".txt", ".yaml"]);
    const imageFiles = allFiles.filter(f => [".jpg", ".jpeg", ".png", ".webp", ".bmp"].includes(f.path.slice(f.path.lastIndexOf(".")).toLowerCase()));
    const textFiles = allFiles.filter(f => f.name.endsWith(".txt") || f.name.endsWith(".yaml"));

    if (imageFiles.length === 0) {
        throw new Error("Unacceptable file structure: No images found.");
    }

    // Attempt to extract classes
    let classNames = [];
    const classesTxt = textFiles.find(f => f.name === "classes.txt");
    if (classesTxt) {
        const file = await classesTxt.handle.getFile();
        const text = await file.text();
        classNames = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    } else {
        const dataYaml = textFiles.find(f => f.name === "data.yaml" || f.name === "dataset.yaml");
        if (dataYaml) {
            const file = await dataYaml.handle.getFile();
            const rawText = await file.text();
            // Strip comments
            const cleanText = rawText.split("\n").map(l => l.split("#")[0]).join("\n");
            
            const inlineMatch = cleanText.match(/names:\s*\[(.*?)\]/);
            if (inlineMatch && inlineMatch[1].trim()) {
                classNames = inlineMatch[1].split(",").map(n => n.replace(/['"]/g, "").trim()).filter(n => n);
            } else {
                const lines = cleanText.split("\n");
                let inNames = false;
                for (const line of lines) {
                    if (!line.trim()) continue;
                    
                    if (line.trim().startsWith("names:")) {
                        inNames = true;
                        continue;
                    }
                    if (inNames) {
                        // If we see a root key (no indentation), we exited the block
                        if (line.match(/^[a-zA-Z_0-9]+:/) && !line.startsWith(" ") && !line.startsWith("\t")) {
                            break;
                        }
                        
                        // Block sequence: - class0
                        const listItemMatch = line.match(/^\s*-\s*(.*)/);
                        if (listItemMatch) {
                            classNames.push(listItemMatch[1].replace(/['"]/g, "").trim());
                            continue;
                        }
                        
                        // Dictionary: 0: class0
                        const dictItemMatch = line.match(/^\s*\d+\s*:\s*(.*)/);
                        if (dictItemMatch) {
                            classNames.push(dictItemMatch[1].replace(/['"]/g, "").trim());
                            continue;
                        }
                    }
                }
            }
        }
    }

    // Map labels files by base name
    const labelMap = new Map();
    textFiles.filter(f => f.name.endsWith(".txt") && f.name !== "classes.txt").forEach(f => {
        const baseName = f.name.slice(0, f.name.lastIndexOf("."));
        labelMap.set(baseName, f);
    });

    // Determine missing classes from labels if no classes.txt
    if (classNames.length === 0 && format !== "yolo-cls") {
        let maxClassId = -1;
        for (const lbl of labelMap.values()) {
            const file = await lbl.handle.getFile();
            const text = await file.text();
            const lines = text.split("\n");
            for (const line of lines) {
                const parts = line.trim().split(" ");
                if (parts.length > 0 && !isNaN(parts[0])) {
                    maxClassId = Math.max(maxClassId, parseInt(parts[0]));
                }
            }
        }
        for (let i = 0; i <= maxClassId; i++) {
            classNames.push(`Class ${i}`);
        }
    }

    // Build internal class array
    const datasetClasses = classNames.map((name, index) => ({
        id: generateId(),
        name: name,
        color: colorForLabel(name)
    }));

    // Create Dataset Structure
    onProgress?.({ stage: "Creating dataset...", current: 10, total: 100 });
    
    meta.type = formatInfo.type;
    meta.classes = datasetClasses;
    meta.imageCount = imageFiles.length;

    const { datasetHandle, rawHandle } = await createDatasetFolderStructure(projectHandle, meta);

    // Create Job
    const jobId = generateId();
    const job = {
        id: jobId,
        name: "Imported Annotations",
        datasetId: meta.id,
        status: "completed",
        createdAt: new Date().toISOString(),
        imageIds: []
    };

    const newImages = [];
    const newAnnotations = [];

    // Copy Images and Process Labels
    let processed = 0;
    for (const img of imageFiles) {
        onProgress?.({ stage: "Importing images and labels...", current: processed, total: imageFiles.length });

        const baseName = img.name.slice(0, img.name.lastIndexOf("."));
        const newImgId = generateId();
        const ext = img.name.slice(img.name.lastIndexOf("."));
        const storedName = `${newImgId}${ext}`;

        // Copy file
        const file = await img.handle.getFile();
        const destFh = await rawHandle.getFileHandle(storedName, { create: true });
        const w = await destFh.createWritable();
        await w.write(file);
        await w.close();

        // Image DB Record
        const imgRecord = {
            id: newImgId,
            datasetId: meta.id,
            jobId: jobId,
            name: storedName,
            originalName: img.name,
            createdAt: new Date().toISOString(),
            tagIds: []
        };
        newImages.push(imgRecord);
        job.imageIds.push(newImgId);

        // Write meta
        await writeImageMeta(datasetHandle, imgRecord);

        // Check for Label
        const labelFile = labelMap.get(baseName);
        let parsedAnnotations = [];
        if (labelFile) {
            const lf = await labelFile.handle.getFile();
            const text = await lf.text();
            parsedAnnotations = parseYoloLabel(text, format, datasetClasses);
        } else if (format === "yolo-cls") {
            // For classification, folder name might be class name
            const parts = img.path.split("/");
            if (parts.length >= 2) {
                const folderName = parts[parts.length - 2];
                if (folderName !== "images" && folderName !== "train" && folderName !== "val" && folderName !== "test") {
                    let cls = datasetClasses.find(c => c.name === folderName);
                    if (!cls) {
                        cls = { id: generateId(), name: folderName, color: colorForLabel(folderName) };
                        datasetClasses.push(cls);
                    }
                    parsedAnnotations = [{
                        id: generateId(),
                        type: "class",
                        classId: cls.id,
                        visible: true
                    }];
                }
            }
        }

        if (parsedAnnotations.length > 0) {
            const annRecord = {
                id: generateId(),
                datasetId: meta.id,
                imageId: newImgId,
                imageName: storedName,
                data: parsedAnnotations,
                updatedAt: new Date().toISOString(),
                versionId: null
            };
            newAnnotations.push(annRecord);
            
            await writeActiveAnnotationFile(datasetHandle, newImgId, {
                imageId: newImgId,
                imageName: storedName,
                datasetId: meta.id,
                annotations: parsedAnnotations,
                updatedAt: annRecord.updatedAt,
                versionId: null
            });
        }
        
        processed++;
    }

    // Write updated classes to meta
    meta.classes = datasetClasses;
    
    // Save dataset.json (already done once in createDatasetFolderStructure, but we need to update with possibly inferred classes)
    const dsFh = await datasetHandle.getFileHandle("dataset.json", { create: true });
    const mw = await dsFh.createWritable();
    await mw.write(JSON.stringify(meta, null, 2));
    await mw.close();

    // Save job file
    const jobsFolder = await datasetHandle.getDirectoryHandle("jobs", { create: true });
    const jfh = await jobsFolder.getFileHandle(`${jobId}.json`, { create: true });
    const jw = await jfh.createWritable();
    await jw.write(JSON.stringify(job, null, 2));
    await jw.close();

    // Update Project Meta
    await addDatasetToProjectMeta(projectHandle, {
        id: meta.id,
        name: meta.name,
        description: meta.description,
        type: meta.type,
        coverImage: meta.coverImage || null,
        createdAt: meta.createdAt,
        imageCount: imageFiles.length
    });

    // DB Inserts
    onProgress?.({ stage: "Finalizing database...", current: 95, total: 100 });
    await db.datasets.add({
        ...meta,
        folderHandle: datasetHandle
    });
    await db.jobs.add(job);
    if (newImages.length > 0) await db.images.bulkAdd(newImages);
    if (newAnnotations.length > 0) await db.annotations.bulkAdd(newAnnotations);

    onProgress?.({ stage: "Done", current: 100, total: 100 });
    return meta;
}

/**
 * Parsers
 */
function parseYoloLabel(text, format, datasetClasses) {
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const annotations = [];

    for (const line of lines) {
        const parts = line.split(/\s+/).map(Number);
        if (parts.length === 0 || isNaN(parts[0])) continue;

        const classIndex = parts[0];
        const classObj = datasetClasses[classIndex];
        if (!classObj) continue;

        if (format === "yolo-hbb" && parts.length === 5) {
            const [_, xc, yc, w, h] = parts;
            const x1 = xc - w / 2;
            const x2 = xc + w / 2;
            const y1 = yc - h / 2;
            const y2 = yc + h / 2;
            annotations.push({
                id: generateId(),
                type: "bbox",
                points: [x1, y1, x2, y2],
                classId: classObj.id,
                visible: true
            });
        } else if (format === "yolo-segment" && parts.length >= 7 && parts.length % 2 !== 0) {
            const points = parts.slice(1);
            annotations.push({
                id: generateId(),
                type: "poly",
                points: points,
                classId: classObj.id,
                visible: true
            });
        } else if (format === "yolo-obb" && parts.length >= 9) {
            // OBB is typically class x1 y1 x2 y2 x3 y3 x4 y4
            const points = parts.slice(1, 9);
            annotations.push({
                id: generateId(),
                type: "poly",
                points: points,
                classId: classObj.id,
                visible: true
            });
        }
    }
    return annotations;
}
