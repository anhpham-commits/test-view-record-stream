import "./tools-read-stream.css"
import './reader.js'

export default class LeanbotFarmRunStreamView{
    #remoteVideo;
    #snapshotCanvas;
    #placeholder;
    #replayHistoryURLList;
    #replayHistoryCloseButton;
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
    #recordStartTimeStamp = null;
    #recordDuration = 0;
    #replayHistory = [];

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

        // runStreamView
        this.uiRunStreamViewInit(videoOptions);

        // streamQualityModal
        this.uiStreamQualityModalInit();

        target.appendChild(this.#remoteVideo);
        target.appendChild(this.#snapshotCanvas);
        target.appendChild(this.#replayHistoryURLList);
        target.appendChild(this.#placeholder);
        target.appendChild(this.#qualityPopup);

        this.hideQualityPopup();
        this.#resetState();

        globalThis.addEventListener("beforeunload", () => {
            this.#disconnectStream();

            this.#replayHistory.forEach(replay => {
                if (replay.objecturl) {
                    URL.revokeObjectURL(replay.objecturl);
                }
            });

            this.#replayHistory = [];
        });
    }

    uiRunStreamViewInit(videoOptions = {}) {
        // Stream video
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

        // Place holder
        this.#placeholder = document.createElement("div");
        this.#placeholder.className = "placeholder";
        this.#placeholder.id = "placeholder";
        this.#placeholder.textContent = "No Stream";

        // Canvas
        this.#snapshotCanvas = document.createElement("canvas");
        this.#snapshotCanvas.id = "snapshotCanvas";

        // Replay History URL List
        this.#replayHistoryURLList = document.createElement("div");
        this.#replayHistoryURLList.className = "replay-history-list";
        this.#replayHistoryURLList.id = "replayHistoryURLList";
        this.#replayHistoryURLList.style.display = "none";

        // Replay History Close Button
        this.#replayHistoryCloseButton = document.createElement("button");
        this.#replayHistoryCloseButton.type = "button";
        this.#replayHistoryCloseButton.className = "replay-history-close";
        this.#replayHistoryCloseButton.setAttribute("aria-label", "Close replay list");
        this.#replayHistoryCloseButton.textContent = "×";
        this.#replayHistoryCloseButton.addEventListener("click", () => {
            this.hideRelaylist();
        });
        this.#replayHistoryURLList.appendChild(this.#replayHistoryCloseButton);
        setTimeout(() => {
            globalThis.addEventListener("pointerdown", ({ target }) => {
                if (!this.#replayHistoryURLList?.contains(target)) {
                    this.hideRelaylist();
                }
            });
        });
    }

    uiStreamQualityModalInit() {
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
    }

    showRelayList() {
        // this.#replayHistoryURLList.style.display = "block";
        this.#replayHistoryURLList.style.display = "flex";
    }

    hideRelaylist() {
        this.#replayHistoryURLList.style.display = "none";
    }

    #addReplayHistory(replay) {
        const row = document.createElement("div");
        row.className = "replay-history-row";

        const a = document.createElement("a");
        a.href = replay.objecturl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = replay.startTimeStamp;

        const durationSpan = document.createElement("span");
        durationSpan.className = "replay-duration";

        const totalSeconds = Math.round(replay.duration);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        durationSpan.textContent =
            `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

        const sizeSpan = document.createElement("span");
        sizeSpan.className = "replay-size";
        const replaySize = new Blob([JSON.stringify(replay)]).size;
        // console.log("[REPLAY] Entry:", replay);
        // console.log("[REPLAY] Serialized JSON size:", replaySize, "bytes");
        sizeSpan.textContent = `${(replaySize / 1024).toFixed(2)} KB`;
        // sizeSpan.textContent = `${(replaySize / 1024 / 1024).toFixed(2)} MB`;
        // sizeSpan.textContent = `${(replay.size / 1024 / 1024).toFixed(2)} MB`;

        row.append(a, durationSpan, sizeSpan);
        this.#replayHistoryURLList.appendChild(row);
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

    // getStreamReader(){
    //     return this.#reader;
    // }

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

    #measureQualityStats() {
        if (!this.#qualitySamples || this.#qualitySamples.length < 2) {
            return null;
        }

        const oldest = this.#qualitySamples[0];
        const newest = this.#qualitySamples[this.#qualitySamples.length - 1];

        const timeDelta = (newest.timestamp - oldest.timestamp) / 1000;

        if (!Number.isFinite(timeDelta) || timeDelta <= 0) {
            return null;
        }

        const bytesDelta = newest.bytesReceived - oldest.bytesReceived;
        const packetsLostDelta = newest.packetsLost - oldest.packetsLost;
        const packetsReceivedDelta = newest.packetsReceived - oldest.packetsReceived;
        const framesDecodedDelta = newest.framesDecoded - oldest.framesDecoded;

        const bitrate = (bytesDelta * 8) / timeDelta / 1000;
        // const packetLoss = (packetsLostDelta + packetsReceivedDelta) > 0
        //     ? packetsLostDelta / (packetsLostDelta + packetsReceivedDelta)
        //     : 0;
        const jitter = newest.jitter * 1000;
        const framesDecodedPerSecond = framesDecodedDelta / timeDelta;

        const result = {
            bitrate,
            packetsLostDelta,
            packetsReceivedDelta,
            jitter,
            framesDecodedPerSecond,
            totalFrameDecoded: framesDecodedDelta,
            frameWidth: newest.frameWidth,
            frameHeight: newest.frameHeight,
            framesDropped_cumulative: newest.framesDropped,
            freezeCount_cumulative: newest.freezeCount,
            totalFreezesDuration_cumulative: newest.totalFreezesDuration,
            framesDecoded_cumulative: newest.framesDecoded,
            packetsReceived_cumulative: newest.packetsReceived,
            packetsLost_cumulative: newest.packetsLost,
            bytesReceived_cumulative: newest.bytesReceived
        };

        return result;
    }

    #formatQualityStats(result) {
        if (!result) return "Waiting for stats...";

        const direct = [
            `Frame Resolution`.padEnd(24) + `${result.frameWidth} x ${result.frameHeight} px`,
            `Jitter`.padEnd(24) + `${result.jitter} ms`,
            `Frames Dropped`.padEnd(24) + `${result.framesDropped_cumulative} frames`,
            `Freeze Count`.padEnd(24) + `${result.freezeCount_cumulative}`,
            `Total Freeze Duration`.padEnd(24) + `${result.totalFreezesDuration_cumulative} s`,
            `Frames Decoded`.padEnd(24) + `${result.framesDecoded_cumulative} frames`,
            `Packets Received`.padEnd(24) + `${result.packetsReceived_cumulative} packets`,
            `Packets Lost`.padEnd(24) + `${result.packetsLost_cumulative} packets`,
            `Bytes Received`.padEnd(24) + `${result.bytesReceived_cumulative} bytes`
        ];

        const derived = [
            `Bitrate`.padEnd(24) + `${result.bitrate.toFixed(0)} kbps`,
            `Decoded FPS`.padEnd(24) + `${result.framesDecodedPerSecond.toFixed(2)}`,
            `Total Frame Decoded`.padEnd(24) + `${result.totalFrameDecoded} frames`,
            `Packet Loss`.padEnd(24) + `${result.packetsLostDelta} / ${result.packetsLostDelta + result.packetsReceivedDelta}`
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
                if (!stats || typeof stats.forEach !== "function") return;

                let newest = null;
                stats.forEach(report => {
                    const isVideoInbound =
                        (report.type === "inbound-rtp" && report.kind === "video") ||
                        (report.type === "inbound-rtp" && report.mediaType === "video");

                    if (isVideoInbound) {
                        newest = report;
                    }
                });

                if (!newest) return;

                this.#qualitySamples.push(newest);

                if (this.#qualitySamples.length > 9) {
                    this.#qualitySamples.shift();
                }

                const result = this.#measureQualityStats();
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
                this.#recordStartTimeStamp = [
                    now.getFullYear(),
                    String(now.getMonth() + 1).padStart(2, "0"),
                    String(now.getDate()).padStart(2, "0")
                ].join("-") + "_" + [
                    String(now.getHours()).padStart(2, "0"),
                    String(now.getMinutes()).padStart(2, "0"),
                    String(now.getSeconds()).padStart(2, "0")
                ].join("-");
                fileName = `leanbot-recording-${this.#recordStartTimeStamp}${extension}`;
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

            writable = await handle.createWritable();

            const stream = this.#remoteVideo.srcObject;
            const videoStream = new MediaStream(stream.getVideoTracks());

            const recorder = new MediaRecorder(videoStream, {
                mimeType: mimeType
            });

            recorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    this.#recordDuration = event.timecode / 1000;
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

                    await this.#saveReplay();
                } catch (error) {
                    console.error("[RECORD] Failed to close recording file:", error);
                }

                this.#recorder = null;
                this.#recordingWritable = null;
            };

            this.#recorder = recorder;
            this.#recordingWritable = writable;
            this.#recordDuration = 0;

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
    Replay
    ========================================================= */

    async #saveReplay() {
        if (!this.#recordingFileHandle) {
            console.error("[REPLAY] Recording file handle empty!");
            return;
        }

        const file = await this.#recordingFileHandle.getFile();

        console.log("[REPLAY] File:", file);
        console.log("[REPLAY] Name:", file.name);
        console.log("[REPLAY] Size:", file.size);
        console.log("[REPLAY] Type:", file.type);

        if (file.size === 0) {
            console.error("[REPLAY] Recording file is empty!");
            return;
        }

        const objecturl = URL.createObjectURL(file);

        const replay = {
            objecturl: objecturl,
            startTimeStamp: this.#recordStartTimeStamp,
            // filename: file.name,
            duration: this.#recordDuration,
            // size: file.size
        };

        this.#replayHistory.push(replay);
        this.#recordDuration = 0;
        this.#recordStartTimeStamp = null;

        this.#addReplayHistory(replay);

        // console.log("[REPLAY] Clickable replay link:", a);
        console.log("[REPLAY] Replay history:", this.#replayHistory);
    }
}