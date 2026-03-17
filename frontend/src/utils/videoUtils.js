import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

/* =========================================================
   GLOBAL FFmpeg INSTANCE
========================================================= */
let ffmpegInstance = null;

const loadFFmpeg = async () => {
    if (ffmpegInstance) return ffmpegInstance;

    if (!window.crossOriginIsolated) {
        throw new Error("FFmpeg requires crossOriginIsolated=true");
    }

    const baseURL = `${window.location.origin}/ffmpeg`;

    const ffmpeg = new FFmpeg();

    try {
        await ffmpeg.load({
            coreURL: `${baseURL}/ffmpeg-core.js`,
            wasmURL: `${baseURL}/ffmpeg-core.wasm`,
        });
    } catch (err) {
        console.error("FFmpeg LOAD ERROR:", err);

        throw new Error(`
FFmpeg failed to load (ESM mode)

Check:
- Correct files from dist/esm
- No UMD files
- Correct paths

Actual:
${err?.stack || err}
        `);
    }

    ffmpegInstance = ffmpeg;
    return ffmpeg;
};
/* =========================================================
   METADATA EXTRACTION (Native → FFmpeg fallback)
========================================================= */
export const getVideoMetadata = async (file) => {
    try {
        return await getMetadataNative(file);
    } catch (e) {
        console.warn("Native metadata failed, using FFmpeg:", e.message);
        return await getMetadataWithFFmpeg(file);
    }
};

const getMetadataNative = (file) => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = URL.createObjectURL(file);

        video.onloadedmetadata = () => {
            resolve({
                duration: video.duration,
                fps: 30,
                width: video.videoWidth,
                height: video.videoHeight,
            });

            URL.revokeObjectURL(video.src);
        };

        video.onerror = () => reject(new Error("Metadata load failed"));
    });
};

const getMetadataWithFFmpeg = async (file) => {
    const ffmpeg = await loadFFmpeg();
    const fileName = 'meta_input';

    await ffmpeg.writeFile(fileName, await fetchFile(file));

    let logs = "";
    const logHandler = ({ message }) => logs += message + "\n";

    ffmpeg.on('log', logHandler);

    try {
        await ffmpeg.exec(['-i', fileName]);
    } catch {}

    ffmpeg.off('log', logHandler);
    await ffmpeg.deleteFile(fileName);

    const durationMatch = logs.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/);

    let duration = 0;
    if (durationMatch) {
        duration =
            parseFloat(durationMatch[1]) * 3600 +
            parseFloat(durationMatch[2]) * 60 +
            parseFloat(durationMatch[3]);
    }

    const streamMatch = logs.match(/Video:.*?, (\d+)x(\d+).*?, (\d+(?:\.\d+)?) fps/);

    return {
        duration,
        width: streamMatch ? parseInt(streamMatch[1]) : 0,
        height: streamMatch ? parseInt(streamMatch[2]) : 0,
        fps: streamMatch ? parseFloat(streamMatch[3]) : 30,
    };
};

/* =========================================================
   FRAME EXTRACTION (SMART PIPELINE)
========================================================= */
export const extractFrames = async (file, fps = 1, _duration, onProgress) => {
    console.log("Starting extraction pipeline...");

    console.log("DEBUG:", {
        crossOriginIsolated: window.crossOriginIsolated,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        fileType: file.type,
    });

    // STEP 1: Native
    try {
        console.log("Trying native extraction...");
        return await extractFramesNative(file, fps, onProgress);
    } catch (e) {
        console.warn("Native extraction failed:", e.message);
    }

    // STEP 2: FFmpeg fallback
    try {
        console.log("Falling back to FFmpeg...");
        return await extractFramesFFmpeg(file, fps, onProgress);
    } catch (e) {
        console.error("FFmpeg failed:", e.message);

        throw new Error(`
❌ Frame extraction failed completely:

Native failed → unsupported codec
FFmpeg failed → ${e.message}

Fix:
- Check /public/ffmpeg files
- Check headers
- Check console logs
        `);
    }
};

/* =========================================================
   NATIVE EXTRACTION
========================================================= */
const extractFramesNative = async (file, fps, onProgress) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);

    await new Promise((res, rej) => {
        video.onloadedmetadata = res;
        video.onerror = () => rej(new Error("Video decode failed"));
    });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');

    const duration = video.duration;
    const interval = 1 / fps;

    let currentTime = 0;
    const frames = [];

    return new Promise((resolve, reject) => {

        const cleanup = () => {
            URL.revokeObjectURL(video.src);
            video.remove();
        };

        const capture = async () => {
            try {
                ctx.drawImage(video, 0, 0);

                const blob = await new Promise(r =>
                    canvas.toBlob(r, 'image/jpeg', 0.9)
                );

                frames.push(blob);

                currentTime += interval;

                if (onProgress) {
                    onProgress((currentTime / duration) * 100);
                }

                if (currentTime < duration - 0.01) {
                    video.currentTime = currentTime;
                } else {
                    cleanup();
                    resolve(frames);
                }

            } catch (e) {
                cleanup();
                reject(e);
            }
        };

        video.addEventListener('seeked', capture);
        video.onerror = reject;

        video.currentTime = 0;
    });
};

/* =========================================================
   FFmpeg EXTRACTION
========================================================= */
const extractFramesFFmpeg = async (file, fps, onProgress) => {
    const ffmpeg = await loadFFmpeg();
    const input = 'input_video';

    await ffmpeg.writeFile(input, await fetchFile(file));

    await ffmpeg.exec([
        '-i', input,
        '-vf', `fps=${fps}`,
        'frame_%05d.jpg'
    ]);

    const files = await ffmpeg.listDir('/');

    const frames = files
        .filter(f => f.name.startsWith('frame_'))
        .sort((a, b) => a.name.localeCompare(b.name));

    const blobs = [];

    for (let i = 0; i < frames.length; i++) {
        const data = await ffmpeg.readFile(frames[i].name);

        blobs.push(new Blob([data.buffer], { type: 'image/jpeg' }));

        await ffmpeg.deleteFile(frames[i].name);

        if (onProgress) {
            onProgress(((i + 1) / frames.length) * 100);
        }
    }

    await ffmpeg.deleteFile(input);

    return blobs;
};