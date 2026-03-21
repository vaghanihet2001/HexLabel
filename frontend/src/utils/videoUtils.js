import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

/* =========================================================
   GLOBAL FFmpeg INSTANCE
========================================================= */
let ffmpegInstance = null;

const loadFFmpeg = async () => {
    if (ffmpegInstance) return ffmpegInstance;

    if (!window.crossOriginIsolated) {
        throw new Error("FFmpeg requires crossOriginIsolated=true");
    }

    // ✅ CDN base URL (NO local files)
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

    const ffmpeg = new FFmpeg();

    try {
        // ✅ Convert CDN files to blob URLs (fixes CORS issues)
        const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');

        await ffmpeg.load({
            coreURL,
            wasmURL,
        });

    } catch (err) {
        console.error("FFmpeg LOAD ERROR:", err);

        throw new Error(`
FFmpeg failed to load (CDN mode)

Check:
- Internet connection
- CDN accessibility
- crossOrigin isolation headers

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
        video.preload = 'auto';
        video.src = URL.createObjectURL(file);

        let isResolved = false;

        const cleanup = () => {
            if (video.src) URL.revokeObjectURL(video.src);
            video.removeAttribute('src');
            video.remove();
        };

        // If the browser can parse the container (like .mp4) but cannot play the codec (like mpeg4),
        // it may stall indefinitely when asked to decode a frame. 
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                cleanup();
                reject(new Error("Native decoding timeout (codec likely unsupported)"));
            }
        }, 1500);

        video.onloadedmetadata = () => {
            // Force a small seek to authentically test the browser's video decoder
            video.currentTime = Math.min(0.5, video.duration / 2 || 0);
        };

        video.onseeked = () => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeoutId);

                // If dimensions are 0 after seeking, it's just an audio track or dead video decoder
                if (video.videoWidth === 0) {
                    cleanup();
                    return reject(new Error("No valid video track found natively"));
                }

                resolve({
                    duration: video.duration,
                    fps: 30, // Default fallback
                    width: video.videoWidth,
                    height: video.videoHeight,
                    isSupported: true,
                    codec: "native",
                    container: file.name.split('.').pop() || "unknown",
                });
                cleanup();
            }
        };

        video.onerror = () => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeoutId);
                cleanup();
                reject(new Error("Native metadata load failed"));
            }
        };
    });
};

const getMetadataWithFFmpeg = async (file) => {
    const ffmpeg = await loadFFmpeg();
    
    const workDir = '/work_meta';
    try { await ffmpeg.createDir(workDir); } catch(e) {} // ignore if exists
    
    // Instead of copying the massive file into RAM, mount it directly via WORKERFS
    await ffmpeg.mount('WORKERFS', { files: [file] }, workDir);
    const inputPath = `${workDir}/${file.name}`;

    let logs = "";
    const logHandler = ({ message }) => logs += message + "\n";

    ffmpeg.on('log', logHandler);

    try {
        await ffmpeg.exec(['-i', inputPath]);
    } catch {}

    ffmpeg.off('log', logHandler);
    
    // Unmount file reference to clean up
    await ffmpeg.unmount(workDir);

    const durationMatch = logs.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/);

    let duration = 0;
    if (durationMatch) {
        duration =
            parseFloat(durationMatch[1]) * 3600 +
            parseFloat(durationMatch[2]) * 60 +
            parseFloat(durationMatch[3]);
    }

    const streamMatch = logs.match(/Video:.*?, (\d+)x(\d+).*?, (\d+(?:\.\d+)?) fps/);

    const codecMatch = logs.match(/Stream #0:.*?: Video: ([a-zA-Z0-9_-]+)/);
    const containerMatch = logs.match(/Input #0, ([a-zA-Z0-9_,]+),/);

    const codec = codecMatch ? codecMatch[1].toLowerCase() : "unknown";
    const container = containerMatch ? containerMatch[1].split(',')[0].toLowerCase() : "unknown";

    // Only these modern codecs are successfully decoded by @ffmpeg/core WebAssembly build.
    const supportedCodecs = ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'theora'];
    const isSupported = supportedCodecs.includes(codec);

    return {
        duration,
        width: streamMatch ? parseInt(streamMatch[1]) : 0,
        height: streamMatch ? parseInt(streamMatch[2]) : 0,
        fps: streamMatch ? parseFloat(streamMatch[3]) : 30,
        codec,
        container,
        isSupported
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
- Check internet (CDN)
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
    const threshold = 500 * 1024 * 1024; // 500 MB limit for fast memory decoding
    let inputPath = '';
    const workDir = '/work_extract';

    if (file.size < threshold) {
        // High-speed RAM extraction (MEMFS)
        inputPath = 'input_video_' + file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        await ffmpeg.writeFile(inputPath, await fetchFile(file));
    } else {
        // Safe massive-file extraction (WORKERFS)
        try { await ffmpeg.createDir(workDir); } catch(e) {}
        await ffmpeg.mount('WORKERFS', { files: [file] }, workDir);
        inputPath = `${workDir}/${file.name}`;
    }

    await ffmpeg.exec([
        '-i', inputPath,
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

        blobs.push(new Blob([data], { type: 'image/jpeg' }));

        await ffmpeg.deleteFile(frames[i].name);

        if (onProgress) {
            onProgress(((i + 1) / frames.length) * 100);
        }
    }

    if (file.size < threshold) {
        await ffmpeg.deleteFile(inputPath);
    } else {
        await ffmpeg.unmount(workDir);
    }

    return blobs;
};