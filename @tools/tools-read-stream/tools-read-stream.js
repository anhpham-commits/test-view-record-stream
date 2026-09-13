import "./tools-read-stream.css"
import './reader.js'

export default class LeanbotFarmRunStreamView{
    #remoteVideo;
    #snapshotCanvas;
    #placeholder;

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

        // VIDEO ELEMENT
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

        // SNAPSHOT CANVAS
        this.#snapshotCanvas = document.createElement("canvas");
        this.#snapshotCanvas.id = "snapshotCanvas";

        // PLACEHOLDER
        this.#placeholder = document.createElement("div");
        this.#placeholder.className = "placeholder";
        this.#placeholder.id = "placeholder";
        this.#placeholder.textContent = "No Stream";

        target.appendChild(this.#remoteVideo);
        target.appendChild(this.#snapshotCanvas);
        target.appendChild(this.#placeholder);

        this.#resetState();

        globalThis.addEventListener("beforeunload", () => {
            this.#disconnectStream();
        });
    }

    isStreamConnected(){
        return this.#connected;
    }

    getStreamReader(){
        return this.#reader;
    }

    /* =========================================================
    UI DISPLAY CONTROLLER
    ========================================================= */

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

        // 1. Vẽ khung hình hiện tại của video lên canvas
        ctx.drawImage(this.#remoteVideo, 0, 0, width, height);
        this.#runSnapshotShown = true;

        // 2. Chuyển giao diện sang Canvas snapshot TRƯỚC
        this.#setVideoView("snapshot");

        // 3. Dừng video và ngắt kết nối WHEP reader SAU
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
                // console.error("Stream URL can not be empty");
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
        // Cleanup toàn bộ stream hiện tại
        this.#disconnectStream();

        // Reset state
        this.#connected = false;
        this.#runSnapshotShown = false;

        // Reset UI về trạng thái ban đầu
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

        // Prefer MP4 if MediaRecorder supports it
        let mimeType;
        let extension;

        if (MediaRecorder.isTypeSupported("video/mp4")) {
            mimeType = "video/mp4";
            extension = ".mp4";

            console.log("[RECORD] video/mp4 is supported, using MP4");
        } else if (MediaRecorder.isTypeSupported("video/webm")) {
            mimeType = "video/webm";
            extension = ".webm";

            console.log("[RECORD] video/mp4 is not supported, falling back to WebM");
        } else {
            throw new Error("No supported MediaRecorder video format found");
        }

        if (!fileName) {
            fileName = `leanbot-recording${extension}`;
        } else {
            // Nếu caller không truyền extension thì thêm extension phù hợp
            if (!fileName.includes(".")) {
                fileName += extension;
            }
        }

        const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [
                {
                    description: mimeType === "video/mp4"
                        ? "MP4 video"
                        : "WebM video",
                    accept: {
                        [mimeType]: [extension]
                    }
                }
            ]
        });

        const writable = await handle.createWritable();

        try {
            const stream = this.#remoteVideo.srcObject;

            // const recorder = new MediaRecorder(stream, { // both audio and video
            //     mimeType: mimeType
            // });

            const videoStream = new MediaStream(
                stream.getVideoTracks()
            );

            const recorder = new MediaRecorder(videoStream, {
                mimeType: mimeType
            });

            recorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    try {
                        await writable.write(event.data);
                    } catch (error) {
                        console.error(
                            "[RECORD] Failed to write recording data:",
                            error
                        );
                    }
                }
            };

            recorder.onerror = (event) => {
                console.error(
                    "[RECORD] MediaRecorder error:",
                    event.error
                );
            };

            recorder.onstop = async () => {
                try {
                    await writable.close();
                    console.log("[RECORD] Recording file saved");
                } catch (error) {
                    console.error(
                        "[RECORD] Failed to close recording file:",
                        error
                    );
                }

                this.#recorder = null;
                this.#recordingWritable = null;
            };

            this.#recorder = recorder;
            this.#recordingWritable = writable;

            recorder.start(1000);

            console.log(
                `[RECORD] Recording started (${mimeType})`
            );
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


