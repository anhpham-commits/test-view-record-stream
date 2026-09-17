import "./tools-read-stream.css"
import './reader.js'

export default class LeanbotFarmRunStreamView{
    #remoteVideo;
    #snapshotCanvas;
    #placeholder;
    #qualityPopup;
    #qualityContent;
    #qualityCloseButton;
    #qualityStats = {
        inbound_rtp: null
    };
    #qualityStatsInterval = null;
    #qualitySamples = [];

    #connected = false;
    #reader = null;
    #runSnapshotShown = false;

    // RECORDING
    #recorder = null;
    #recordingWritable = null;
    #recordingFileHandle = null;
    #recordingPreviewUrl = null;

    #preview = null;
    #previewVideo = null;
    #previewCloseButton = null;

    onStreamConnect = () => {}
    onStreamDisconect = () => {}
    onStreamConnectError = () => {}

    constructor(containerElement, videoOptions = {}){
        const target = typeof containerElement === "string"
            ? document.getElementById(containerElement)
            : containerElement;

        if (!target) {
            console.error("[tools-view-stream] Target container not found");
            return;
        }

        target.innerHTML = "";

        this.#remoteVideo = document.createElement("video");
        this.#remoteVideo.id = "remoteVideo";
        this.#remoteVideo.controls = videoOptions.controls !== undefined ? videoOptions.controls : true;
        this.#remoteVideo.autoplay = videoOptions.autoplay !== undefined ? videoOptions.autoplay : true;
        this.#remoteVideo.muted = videoOptions.muted !== undefined ? videoOptions.muted : true;
        this.#remoteVideo.playsInline = videoOptions.playsinline !== undefined
            ? videoOptions.playsinline
            : (videoOptions.playsInline !== undefined ? videoOptions.playsInline : true);

        if (videoOptions.attributes && typeof videoOptions.attributes === "object") {
            Object.entries(videoOptions.attributes).forEach(([key, val]) => {
                this.#remoteVideo.setAttribute(key, val);
            });
        }

        this.#snapshotCanvas = document.createElement("canvas");
        this.#snapshotCanvas.id = "snapshotCanvas";

        this.#placeholder = document.createElement("div");
        this.#placeholder.className = "placeholder";
        this.#placeholder.id = "placeholder";
        this.#placeholder.textContent = "No Stream";

        this.#qualityPopup = document.createElement("div");
        this.#qualityPopup.id = "streamQualityPopup";
        this.#qualityPopup.innerHTML = `
            <div class="stream-quality-popup">
                <div class="stream-quality-header">
                    <h6>Stream Quality</h6>
                    <button class="stream-quality-close" type="button" aria-label="Close stream quality">×</button>
                </div>
                <pre class="stream-quality-content"></pre>
            </div>
        `;

        this.#qualityCloseButton = this.#qualityPopup.querySelector(".stream-quality-close");
        this.#qualityContent = this.#qualityPopup.querySelector(".stream-quality-content");

        const qualityPopupBox =
            this.#qualityPopup.querySelector(".stream-quality-popup");

        const qualityHeader =
            this.#qualityPopup.querySelector(".stream-quality-header");

        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        qualityHeader.addEventListener("pointerdown", (event) => {
            // Không bắt đầu drag khi click vào nút Close
            if (event.target.closest(".stream-quality-close")) {
                return;
            }

            const rect = qualityPopupBox.getBoundingClientRect();

            isDragging = true;

            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;

            qualityHeader.setPointerCapture(event.pointerId);

            qualityPopupBox.style.transform = "none";
        });

        qualityHeader.addEventListener("pointermove", (event) => {
            if (!isDragging) return;

            let left = event.clientX - offsetX;
            let top = event.clientY - offsetY;

            // Không cho kéo popup ra hoàn toàn khỏi màn hình
            const rect = qualityPopupBox.getBoundingClientRect();

            const minVisible = 30;

            left = Math.max(
                minVisible - rect.width,
                Math.min(left, window.innerWidth - minVisible)
            );

            top = Math.max(
                0,
                Math.min(top, window.innerHeight - minVisible)
            );

            qualityPopupBox.style.left = `${left}px`;
            qualityPopupBox.style.top = `${top}px`;
        });

        qualityHeader.addEventListener("pointerup", (event) => {
            isDragging = false;

            if (qualityHeader.hasPointerCapture(event.pointerId)) {
                qualityHeader.releasePointerCapture(event.pointerId);
            }
        });

        qualityHeader.addEventListener("pointercancel", () => {
            isDragging = false;
        });
        this.#resetQualityStats();

        this.#qualityCloseButton.addEventListener("click", () => {
            this.hideQualityPopup();
        });

        this.#qualityPopup.addEventListener("click", (event) => {
            if (event.target === this.#qualityPopup) {
                this.hideQualityPopup();
            }
        });

        this.#preview = document.createElement("div");
        this.#preview.className = "recording-preview";
        this.#preview.id = "recordingPreview";

        this.#preview.innerHTML = `
            <div class="recording-preview-content">
                <video
                    class="recording-preview-video"
                    controls
                    playsinline
                ></video>

                <button
                    class="recording-preview-close"
                    type="button"
                    aria-label="Close preview"
                >
                    ×
                </button>
            </div>
        `;

        this.#previewVideo =
            this.#preview.querySelector(".recording-preview-video");

        this.#previewCloseButton =
            this.#preview.querySelector(".recording-preview-close");

        this.#previewCloseButton.addEventListener("click", () => {
            this.hidePreview();
        });

        this.#preview.addEventListener("click", (event) => {
            if (event.target === this.#preview) {
                this.hidePreview();
            }
        });

        target.appendChild(this.#remoteVideo);
        target.appendChild(this.#snapshotCanvas);
        target.appendChild(this.#placeholder);
        target.appendChild(this.#qualityPopup);
        target.appendChild(this.#preview);

        this.hideQualityPopup();
        this.#resetState();
        this.hidePreview();

        globalThis.addEventListener("beforeunload", () => {
            this.#disconnectStream();
        });
    }

    isStreamConnected(){
        return this.#connected;
    }

    isQualityPopupVisible() {
        return this.#qualityPopup && this.#qualityPopup.style.display !== "none";
    }

    showQualityPopup() {
        if (!this.#qualityPopup) return;
        this.#qualityPopup.style.display = "flex";
        document.body.style.overflow = "hidden";
    }

    hideQualityPopup() {
        if (!this.#qualityPopup) return;
        this.#qualityPopup.style.display = "none";
        document.body.style.overflow = "";
    }

    getStreamReader(){
        return this.#reader;
    }

    #setVideoView(view) {
        this.#remoteVideo.style.display = view === "video" ? "block" : "none";
        this.#placeholder.style.display = view === "placeholder" ? "flex" : "none";
        this.#snapshotCanvas.style.display = view === "snapshot" ? "block" : "none";
    }

    #showPlaceholder(text = "No Stream") {
        this.#placeholder.textContent = text;
        this.#setVideoView("placeholder");
    }

    #showStream() {
        this.#setVideoView("video");
    }

    #resetQualityStats() {
        this.#qualityStats.inbound_rtp = null;
        this.#qualitySamples = [];
        this.#updateQualityContent("");
    }

    #measureQualityStats(stats) {
        if (!stats || typeof stats.forEach !== "function") {
            return null;
        }

        const timestamp = performance.now();

        let currentInbound = null;

        stats.forEach(report => {
            const isVideoInbound =
                (report.type === "inbound-rtp" && report.kind === "video") ||
                (report.type === "inbound-rtp" && report.mediaType === "video");

            if (isVideoInbound) {
                currentInbound = report;
            }
        });

        if (!currentInbound) {
            return null;
        }

        if (!this.#qualityStats.inbound_rtp) {
            this.#qualityStats.inbound_rtp = currentInbound;
            return null;
        }

        const prev = this.#qualityStats.inbound_rtp;
        const timeDelta = (currentInbound.timestamp - prev.timestamp) / 1000;

        if (!Number.isFinite(timeDelta) || timeDelta <= 0) {
            this.#qualityStats.inbound_rtp = currentInbound;
            return null;
        }

        const bytesDelta = currentInbound.bytesReceived - prev.bytesReceived;
        const packetsLostDelta = currentInbound.packetsLost - prev.packetsLost;
        const packetsReceivedDelta = currentInbound.packetsReceived - prev.packetsReceived;
        const framesDecodedDelta = currentInbound.framesDecoded - prev.framesDecoded;

        const bitrate = (bytesDelta * 8) / timeDelta / 1000;
        const packetLoss = (packetsLostDelta + packetsReceivedDelta) > 0
            ? packetsLostDelta / (packetsLostDelta + packetsReceivedDelta)
            : 0;
        const jitter = currentInbound.jitter * 1000;
        const framesDecodedPerSecond = framesDecodedDelta / timeDelta;
        const isFrozen = bitrate > 10 && framesDecodedDelta === 0;

        const result = {
            timestamp,
            timeDelta,
            bitrate,
            packetLoss,
            jitter,
            framesDecodedPerSecond,
            isFrozen,
            frameWidth: currentInbound.frameWidth,
            frameHeight: currentInbound.frameHeight,
            framesDropped_cumulative: currentInbound.framesDropped,
            freezeCount_cumulative: currentInbound.freezeCount,
            totalFreezesDuration_cumulative: currentInbound.totalFreezesDuration,
            framesDecoded_cumulative: currentInbound.framesDecoded,
            packetsReceived_cumulative: currentInbound.packetsReceived,
            packetsLost_cumulative: currentInbound.packetsLost,
            bytesReceived_cumulative: currentInbound.bytesReceived
        };

        this.#qualityStats.inbound_rtp = currentInbound;
        return result;
    }

    #getQualityAverage() {
        if (this.#qualitySamples.length === 0) {
            return null;
        }

        const samples = this.#qualitySamples;

        const measureStats = (key) => {
            const values = samples
                .map(sample => sample[key])
                .filter(value => Number.isFinite(value));

            if (values.length === 0) {
                return {
                    avg: null,
                    min: null,
                    max: null
                };
            }

            return {
                avg: values.reduce((sum, value) => sum + value, 0) / values.length,
                min: Math.min(...values),
                max: Math.max(...values)
            };
        };

        const latest = samples[samples.length - 1];
        const first = samples[0];

        const result = {
            measurementWindow: (latest.timestamp - first.timestamp) / 1000,
            timeDelta: latest.timeDelta,
            bitrate: measureStats("bitrate"),
            packetLoss: measureStats("packetLoss"),
            jitter: measureStats("jitter"),
            framesDecodedPerSecond: measureStats("framesDecodedPerSecond"),
            totalFrameDecoded: latest.framesDecoded_cumulative - first.framesDecoded_cumulative,

            isFrozen: samples.some(sample => sample.isFrozen),

            frameWidth: latest.frameWidth,
            frameHeight: latest.frameHeight,
            framesDropped_cumulative: latest.framesDropped_cumulative,
            freezeCount_cumulative: latest.freezeCount_cumulative,
            totalFreezesDuration_cumulative: latest.totalFreezesDuration_cumulative,
            framesDecoded_cumulative: latest.framesDecoded_cumulative,
            packetsReceived_cumulative: latest.packetsReceived_cumulative,
            packetsLost_cumulative: latest.packetsLost_cumulative,
            bytesReceived_cumulative: latest.bytesReceived_cumulative,
        };

        return result;
    }

    #formatQualityStats(result) {
        if (!result) return "Waiting for stats...";

        const direct = [
            `frameWidth: ${result.frameWidth} px`,
            `frameHeight: ${result.frameHeight} px`,
            // `jitter: ${result.jitter} ms`,
            `framesDropped_cumulative: ${result.framesDropped_cumulative} frames`,
            `freezeCount_cumulative: ${result.freezeCount_cumulative}`,
            `totalFreezesDuration_cumulative: ${result.totalFreezesDuration_cumulative} s`,
            `framesDecoded_cumulative: ${result.framesDecoded_cumulative} frames`,
            `packetsReceived_cumulative: ${result.packetsReceived_cumulative} packets`,
            `packetsLost_cumulative: ${result.packetsLost_cumulative} packets`,
            `bytesReceived_cumulative: ${result.bytesReceived_cumulative} bytes`
        ];

        const fmt = (value) => value.toFixed(3).padStart(7);

        const stat = (avg, min, max) =>
            `avg ${fmt(avg)} | min ${fmt(min)} | max ${fmt(max)}`;

        const derived = [
            `timeDelta              : ${result.timeDelta.toFixed(3)} s`,
            `measurementWindow      : ${result.measurementWindow.toFixed(3)} s`,
            `totalFrameDecoded      : ${result.totalFrameDecoded} frames`,

            `bitrate (Kbps)                : ${stat(result.bitrate.avg, result.bitrate.min, result.bitrate.max)}`,
            `packetLoss (%)                : ${stat(result.packetLoss.avg, result.packetLoss.min, result.packetLoss.max)}`,
            `framesDecodedPerSecond (fps)  : ${stat(result.framesDecodedPerSecond.avg, result.framesDecodedPerSecond.min, result.framesDecodedPerSecond.max)}`,
            `jitter (ms)                   : ${stat(result.jitter.avg, result.jitter.min, result.jitter.max)}`,

            `isFrozen               : ${result.isFrozen}`
        ];

        return direct.concat([""], derived).join("\n");
    }

    #updateQualityContent(content) {
        if (!this.#qualityContent) return;
        this.#qualityContent.textContent = content;
    }

    #startQualityMonitoring() {
        if (this.#qualityStatsInterval || !this.#reader) return;

        const readerInstance = this.#reader;

        this.#qualityStatsInterval = setInterval(async () => {
            try {
                const stats = await readerInstance.getStats();
                const result = this.#measureQualityStats(stats);

                if (!result) return;

                this.#qualitySamples.push(result);

                if (this.#qualitySamples.length > 9) { // only keep most recent 9 last getStats(interval ~8s ~ 100 sample)
                    this.#qualitySamples.shift();        // push out oldest sample
                }

                const average = this.#getQualityAverage();
                const formatted = this.#formatQualityStats(average);

                this.#updateQualityContent(formatted);
            } catch (error) {
                console.error("[STREAM] getStats() error:", error);
            }
        }, 1000);
    }

    #stopQualityMonitoring() {
        if (!this.#qualityStatsInterval) return;

        clearInterval(this.#qualityStatsInterval);
        this.#qualityStatsInterval = null;
        this.#resetQualityStats();
        this.hideQualityPopup();
    }

    /* =========================================================
   SNAPSHOT
   ========================================================= */

    #captureFinalSnapshot() {
        if (this.#runSnapshotShown) return true;
        if (!this.#remoteVideo.srcObject || this.#remoteVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return false;
        }

        const width = this.#remoteVideo.videoWidth;
        const height = this.#remoteVideo.videoHeight;

        this.#snapshotCanvas.width = width;
        this.#snapshotCanvas.height = height;

        const ctx = this.#snapshotCanvas.getContext("2d", { alpha: false });
        if (!ctx) return false;

        ctx.drawImage(this.#remoteVideo, 0, 0, width, height);
        this.#runSnapshotShown = true;
        this.#setVideoView("snapshot");
        this.#remoteVideo.pause();

        return true;
    }

    /* =========================================================
    CONNECT / DISCONNECT (WebRTC WHEP)
    ========================================================= */

    disconnectStreamAndTakeSnapshot() {
        try{
            this.#captureFinalSnapshot();
            this.#disconnectStream();
            this.#connected = false;
        }
        catch(error){
            console.error("disconnect stream and take snapshot error:", error);
        }
    }

    connectStream(streamURL) {
        try {
            this.#disconnectStream();
            this.#runSnapshotShown = false;

            if (!streamURL) {
                this.#showPlaceholder();
                throw new Error("Stream URL can not be empty");
            }

            const whepUrl = streamURL.endsWith("/") ? `${streamURL}whep` : `${streamURL}/whep`;
            this.#showPlaceholder("Connecting...");

            this.#reader = new MediaMTXWebRTCReader({
                url: whepUrl,
                user: "", pass: "", token: "",

                onError: (error) => {
                    console.error("[STREAM] WebRTC error:", error);
                    this.onStreamConnectError(error);
                    if (this.#runSnapshotShown) return;

                    this.#resetState();
                    this.#showPlaceholder("Stream error");
                },

                onTrack: (event) => {
                    if (this.#runSnapshotShown) return;

                    if (event.streams?.[0]) {
                        this.#remoteVideo.srcObject = event.streams[0];
                    } else {
                        if (!this.#remoteVideo.srcObject) {
                            this.#remoteVideo.srcObject = new MediaStream();
                        }
                        this.#remoteVideo.srcObject.addTrack(event.track);
                    }

                    this.#connected = true;
                    this.onStreamConnect();
                    this.#showStream();
                    this.#startQualityMonitoring();

                    this.#remoteVideo.play().catch(error => console.warn("[STREAM] play():", error));
                },

                onDataChannel: (event) => {
                    console.log("[STREAM] WebRTC data channel:", event.channel);
                }
            });
        } catch (error) {
            console.error("[STREAM] Failed to create WebRTC reader:", error);
            this.#showPlaceholder("Stream error:");
            this.onStreamConnectError(error);
        }
    }

    #disconnectStream() {

        this.#stopQualityMonitoring();

        if (this.#reader !== null) {
            this.#reader.close();
            this.#reader = null;
        }

        if (this.#remoteVideo && this.#remoteVideo.srcObject) {
            this.#remoteVideo.srcObject.getTracks().forEach(track => {
                track.stop();
            });
            this.#remoteVideo.srcObject = null;
        }
    }

    #resetState() {
        this.#disconnectStream();

        this.#connected = false;
        this.#runSnapshotShown = false;
        this.#setVideoView("placeholder");
    }

    /* =========================================================
    RECORDING
    ========================================================= */

    isRecording() {
        return this.#recorder !== null &&
            this.#recorder.state === "recording";
    }

    async recordStart(fileName = null) {

        this.#clearPreview();
        
        let writable = null;

        try{

            if (!this.#connected || !this.#remoteVideo.srcObject) {
                throw new Error("Stream is not connected");
            }

            if (this.isRecording()) {
                throw new Error("Recording is already running");
            }

            if (!globalThis.showSaveFilePicker) {
                throw new Error("File System Access API is not supported");
            }

            if (!MediaRecorder.isTypeSupported("video/webm")) {
                throw new Error("WebM recording is not supported in this browser");
            }

            const mimeType = "video/webm";
            const extension = ".webm";

            if (!fileName) {
                const now = new Date();
                const timestamp = [
                    now.getFullYear(),
                    String(now.getMonth() + 1).padStart(2, "0"),
                    String(now.getDate()).padStart(2, "0")
                ].join("-") + "_" + [
                    String(now.getHours()).padStart(2, "0"),
                    String(now.getMinutes()).padStart(2, "0"),
                    String(now.getSeconds()).padStart(2, "0")
                ].join("-");
                fileName = `leanbot-recording-${timestamp}${extension}`;
            } else if (!fileName.includes(".")) {
                fileName += extension;
            }

            const handle = await globalThis.showSaveFilePicker({
                suggestedName: fileName,
                types: [
                    {
                        description: "WebM video",
                        accept: {
                            [mimeType]: [extension]
                        }
                    }
                ]
            });
            this.#recordingFileHandle = handle;

            const writable = await handle.createWritable();

            const stream = this.#remoteVideo.srcObject;
            const videoStream = new MediaStream(stream.getVideoTracks());

            const recorder = new MediaRecorder(videoStream, {
                mimeType: mimeType
            });

            recorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    try {
                        await writable.write(event.data);
                    } catch (error) {
                        console.error("[RECORD] Failed to write recording data:", error);
                    }
                }
            };

            recorder.onerror = (event) => {
                console.error("[RECORD] MediaRecorder error:", event.error);
            };

            recorder.onstop = async () => {
                try {
                    await writable.close();
                    console.log("[RECORD] Recording file saved");

                    await this.#savePreview();
                } catch (error) {
                    console.error("[RECORD] Failed to close recording file:", error);
                }

                this.#recorder = null;
                this.#recordingWritable = null;
            };

            this.#recorder = recorder;
            this.#recordingWritable = writable;

            recorder.start(1000);
            console.log(`[RECORD] Recording started (${mimeType})`);
            return {success: true, exception: null};
        } catch (error) {
            const errorMessage = error.message || String(error) || "Unknown error";
            if(errorMessage.includes("The user aborted a request") || errorMessage.includes("The user cancelled a request")) {
                console.warn("[RECORD] Recording start cancelled by user");
                return {success: false, exception: "cancelled"};
            }

            if (writable) {
                await writable.close().catch(() => {});
            }

            // throw error;
            console.error("[RECORD] Failed to start recording:", error);
            return {success: false, exception: errorMessage};
        }
    }

    async recordStop() {
        if (!this.#recorder) {
            return;
        }

        if (this.#recorder.state === "inactive") {
            return;
        }

        console.log("[RECORD] Stopping recording");

        return new Promise((resolve) => {
            const recorder = this.#recorder;
            const onStop = recorder.onstop;

            recorder.onstop = async (event) => {
                try {
                    if (onStop) {
                        await onStop.call(recorder, event);
                    }
                } finally {
                    resolve();
                }
            };

            recorder.stop();
        }).catch((error) => {
            console.error("Error stopping recorder:", error);
        });
    }


    /* =========================================================
    Preview
    ========================================================= */

    async #savePreview(){

        if(!this.#recordingFileHandle){
            console.error("Recording file handle empty!!!");
            return;
        }

        // Read back the file that was just written
        const file = await this.#recordingFileHandle.getFile();

        // Create local browser preview URL
        this.#recordingPreviewUrl = URL.createObjectURL(file);

        // console.log("[RECORD] Preview URL:", this.#recordingPreviewUrl);
    }

    showPreview() {
        if (!this.#preview || !this.#recordingPreviewUrl) {
            console.warn("[RECORD] No recording preview available");
            return false;
        }

        this.#previewVideo.src = this.#recordingPreviewUrl;
        this.#previewVideo.load();

        this.#preview.style.display = "flex";

        this.#previewVideo.play().catch(error => {
            // Không phải lỗi nghiêm trọng: browser có thể chặn autoplay
            console.warn("[RECORD] Preview autoplay:", error);
        });

        return true;
    }

    hidePreview() {
        if (!this.#preview) return;

        this.#previewVideo.pause();
        this.#preview.style.display = "none";
    }

    #clearPreview() {
        this.hidePreview();

        if (this.#recordingPreviewUrl) {
            URL.revokeObjectURL(this.#recordingPreviewUrl);
            this.#recordingPreviewUrl = null;
        }

        if (this.#previewVideo) {
            this.#previewVideo.removeAttribute("src");
            this.#previewVideo.load();
        }

        this.#recordingFileHandle = null;

        console.log("[RECORD] Preview cleared");
    }
}
