
import MP4Box from 'mp4box';

/**
 * Extracts metadata from a video file.
 * @param {File} file - The video file.
 * @returns {Promise<{duration: number, fps: number, width: number, height: number}>}
 */
export const getVideoMetadata = (file) => {
    return new Promise((resolve, reject) => {
        const mp4boxfile = MP4Box.createFile();

        mp4boxfile.onError = (e) => {
            reject(e);
        };

        mp4boxfile.onReady = (info) => {
            const track = info.videoTracks[0];
            const duration = info.duration / info.timescale; // seconds
            // Calculate FPS: nb_samples / (duration in calculated timescale)
            // Or use track.movie_timescale / track.movie_duration if available, but usually track.nb_samples / (track.duration / track.timescale)
            // MP4Box provides generic duration. 
            // A safe way for FPS is sample count / duration

            let fps = 30; // default
            if (track && track.nb_samples && track.duration && track.timescale) {
                fps = (track.nb_samples * track.timescale) / track.duration;
            } else if (track && track.frame_rate) {
                // Sometimes mp4box gives 0, so fallback
                fps = track.frame_rate > 0 ? track.frame_rate : 30;
            }

            resolve({
                duration,
                fps,
                width: track ? track.video.width : 0,
                height: track ? track.video.height : 0,
            });
            mp4boxfile.flush();
        };

        const reader = new FileReader();
        reader.onload = (e) => {
            const arrayBuffer = e.target.result;
            arrayBuffer.fileStart = 0;
            mp4boxfile.appendBuffer(arrayBuffer);
        };
        reader.readAsArrayBuffer(file);
    });
};

/**
 * Extracts frames from a video file at a specified rate.
 * @param {File} file - The video file.
 * @param {number} extractRate - Frames per second to extract.
 * @param {number} totalDuration - Total duration of video in seconds.
 * @param {function} onProgress - Callback (percent, currentFrameBlob)
 * @returns {Promise<Array<Blob>>}
 */
export const extractFrames = async (file, extractRate, _totalDuration, onProgress) => {
    return new Promise(async (resolve, reject) => {
        try {
            console.log("Starting extractFrames", { file, extractRate });
            const video = document.createElement('video');
            video.src = URL.createObjectURL(file);
            video.muted = true;
            video.playsInline = true;

            // Wait for metadata
            await new Promise((res) => {
                video.onloadedmetadata = () => res();
            });

            const duration = video.duration;
            console.log("Video metadata loaded", { duration, width: video.videoWidth, height: video.videoHeight });

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const extractedBlobs = [];
            const interval = 1 / extractRate;
            let currentTime = 0;

            // Use video.duration for total calculations
            const totalFramesToExtract = Math.floor(duration * extractRate);
            console.log("Extraction setup", { interval, totalFramesToExtract });

            let processedCount = 0;

            const onSeeked = async () => {
                console.log("Seeked to", video.currentTime);
                // Draw to canvas
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // Convert to blob
                const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
                extractedBlobs.push(blob);

                processedCount++;
                if (onProgress) onProgress(Math.min(100, Math.round((processedCount / (totalFramesToExtract || 1)) * 100)));

                currentTime += interval;

                // Floating point tolerance for "less than duration"
                // If we are within 0.01s of the end or past it, stop.
                // However, user wants up to duration. 
                // Using a small epsilon to avoid infinite loops if it gets stuck near end.
                console.log("Next target time", currentTime, "Limit", duration);

                if (currentTime < duration && (duration - currentTime) > 0.001) {
                    video.currentTime = currentTime;
                } else {
                    console.log("Extraction complete", extractedBlobs.length);
                    // Done
                    cleanup();
                    resolve(extractedBlobs);
                }
            };

            const onError = (e) => {
                console.error("Video error", e);
                cleanup();
                reject(e);
            };

            const cleanup = () => {
                video.removeEventListener('seeked', onSeeked);
                video.removeEventListener('error', onError);
                URL.revokeObjectURL(video.src);
            };

            video.addEventListener('seeked', onSeeked);
            video.addEventListener('error', onError);

            // Start processing
            console.log("Setting initial currentTime to", currentTime);
            video.currentTime = currentTime;

        } catch (e) {
            console.error("Changes in extractFrames failed", e);
            reject(e);
        }
    });
};
