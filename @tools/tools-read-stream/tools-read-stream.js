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

    #connected = false;
    #reader = null;
    #runSnapshotShown = false;

    // RECORDING
    #recorder = null;
    #recordingWritable = null;

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
        this.#resetQualityStats();

        this.#qualityCloseButton.addEventListener("click", () => {
            this.hideQualityPopup();
        });

        this.#qualityPopup.addEventListener("click", (event) => {
            if (event.target === this.#qualityPopup) {
                this.hideQualityPopup();
            }
        });

        target.appendChild(this.#remoteVideo);
        target.appendChild(this.#snapshotCanvas);
        target.appendChild(this.#placeholder);
        target.appendChild(this.#qualityPopup);

        this.hideQualityPopup();
        this.#resetState();

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
        this.#updateQualityContent("");
    }

    #measureQualityStats(stats) {
        if (!stats || typeof stats.forEach !== "function") {
            return null;
        }

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

    #formatQualityStats(result) {
        if (!result) return "Waiting for stats...";

        const direct = [
            `frameWidth: ${result.frameWidth} px`,
            `frameHeight: ${result.frameHeight} px`,
            `jitter: ${result.jitter} ms`,
            `framesDropped_cumulative: ${result.framesDropped_cumulative} frames`,
            `freezeCount_cumulative: ${result.freezeCount_cumulative}`,
            `totalFreezesDuration_cumulative: ${result.totalFreezesDuration_cumulative} s`,
            `framesDecoded_cumulative: ${result.framesDecoded_cumulative} frames`,
            `packetsReceived_cumulative: ${result.packetsReceived_cumulative} packets`,
            `packetsLost_cumulative: ${result.packetsLost_cumulative} packets`,
            `bytesReceived_cumulative: ${result.bytesReceived_cumulative} bytes`
        ];

        const derived = [
            `timeDelta: ${result.timeDelta.toFixed(3)} s`,
            `bitrate: ${result.bitrate.toFixed(3)} Kbps`,
            `packetLoss: ${result.packetLoss}`,
            `framesDecodedPerSecond: ${result.framesDecodedPerSecond.toFixed(3)} fps`,
            `isFrozen: ${result.isFrozen}`
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
                const formatted = this.#formatQualityStats(result);
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
        this.#captureFinalSnapshot();
        this.#disconnectStream();
        this.#connected = false;
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
            try {
                this.#reader.close();
            } catch (error) {
                console.warn("[STREAM] Error closing MediaMTX reader:", error);
            }
            this.#reader = null;
        }

        if (this.#remoteVideo && this.#remoteVideo.srcObject) {
            this.#remoteVideo.srcObject.getTracks().forEach(track => {
                try { track.stop(); } catch (e) {}
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
        if (!this.#connected || !this.#remoteVideo.srcObject) {
            throw new Error("Stream is not connected");
        }

        if (this.isRecording()) {
            throw new Error("Recording is already running");
        }

        if (!window.showSaveFilePicker) {
            throw new Error("File System Access API is not supported");
        }

        let mimeType;
        let extension;

        if (MediaRecorder.isTypeSupported("video/mp4")) {
            mimeType = "video/mp4";
            extension = ".mp4";
        } else if (MediaRecorder.isTypeSupported("video/webm")) {
            mimeType = "video/webm";
            extension = ".webm";
        } else {
            throw new Error("No supported MediaRecorder video format found");
        }

        if (!fileName) {
            fileName = `leanbot-recording${extension}`;
        } else if (!fileName.includes(".")) {
            fileName += extension;
        }

        const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [
                {
                    description: mimeType === "video/mp4" ? "MP4 video" : "WebM video",
                    accept: {
                        [mimeType]: [extension]
                    }
                }
            ]
        });

        const writable = await handle.createWritable();

        try {
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
        } catch (error) {
            await writable.close().catch(() => {});
            throw error;
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
        });
    }
}


