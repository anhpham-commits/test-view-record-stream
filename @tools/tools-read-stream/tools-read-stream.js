import "./tools-read-stream.css"
import './reader.js'

export default class LeanbotFarmRunStreamView{
    #remoteVideo;
    #snapshotCanvas;
    #placeholder;

    #connected = false;
    #reader = null;
    #runSnapshotShown = false;

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
                stopMonitorStreamStats();
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

}


