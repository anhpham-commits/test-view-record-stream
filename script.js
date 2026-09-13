import "./style.css"
import LeanbotFarmRunStreamView from "./@tools/tools-read-stream/tools-read-stream.js";
import StreamQuality from "./@tools/tools-stream-quality/stream-quality.js";

/* =========================================================
   DOM & INSTANCES
   ========================================================= */

const btnConnect = document.getElementById("btnConnect");
const statsButton = document.getElementById("statsButton");
const btnRecordStart = document.getElementById("btnRecordStart");
const btnRecordStop = document.getElementById("btnRecordStop");

btnRecordStart.disabled = true;
btnRecordStop.disabled = true;

const streamView = new LeanbotFarmRunStreamView("video", {
    controls: true,
    autoplay: true,
    muted: true,
    playsinline: true
});

const streamQuality = new StreamQuality();

/* =========================================================
   STATE & STREAM CALLBACKS
   ========================================================= */

let streamStatsInterval = null;

streamView.onStreamConnect = () => {
    setConnectButton("connected");

    btnRecordStart.disabled = false;
    btnRecordStop.disabled = true;

    startMonitorStreamStats(streamView.getStreamReader());
};

streamView.onStreamConnectError = () => {
    setConnectButton("disconnected");

    btnRecordStart.disabled = true;
    btnRecordStop.disabled = true;

    stopMonitorStreamStats();
};

/* =========================================================
   MEDIA MTX (WHEP ENDPOINT)
   ========================================================= */

function getStreamURL() {
    const id = document.getElementById("RemoteLeanbot").value.trim();
    if (!id) return null;

    const remoteleanbot = "remote" + id;
    return `https://streaming-qa.pythaverse.space/stream/${remoteleanbot}/`;
}

/* =========================================================
   UI DISPLAY CONTROLLER
   ========================================================= */

function setConnectButton(state) {
    switch (state) {
        case "connecting":
            btnConnect.disabled = true;
            btnConnect.textContent = "Connecting...";
            break;

        case "connected":
            btnConnect.disabled = false;
            btnConnect.textContent = "Disconnect";
            break;

        case "disconnected":
        default:
            btnConnect.disabled = false;
            btnConnect.textContent = "Connect";
            break;
    }
}

/* =========================================================
   STREAM STATS MONITORING
   ========================================================= */

function resetStats() {
    streamQuality.resetStats();
}

function startMonitorStreamStats(readerInstance) {
    if (streamStatsInterval || !readerInstance) return;

    statsButton.disabled = false;

    streamStatsInterval = setInterval(async () => {
        try {
            const stats = await readerInstance.getStats();
            const streamPertString = streamQuality.updateFromStats(stats);
            console.log(streamPertString);
        } catch (error) {
            console.error("getStats() error:", error);
        }
    }, 1000);
}

function stopMonitorStreamStats() {
    if (!streamStatsInterval) return;

    clearInterval(streamStatsInterval);
    streamStatsInterval = null;

    statsButton.disabled = true;
    streamQuality.hide();
    resetStats();
}

statsButton.addEventListener("click", () => {
    if (streamQuality.isVisible()) {
        streamQuality.hide();
    } else {
        streamQuality.show();
    }
});

/* =========================================================
   RECORDING
   ========================================================= */

btnRecordStart.addEventListener("click", async () => {
    try {
        await streamView.recordStart();

        btnRecordStart.disabled = true;
        btnRecordStop.disabled = false;
    } catch (error) {
        console.error("[RECORD] Start failed:", error);
    }
});

btnRecordStop.addEventListener("click", async () => {
    try {
        await streamView.recordStop();

        btnRecordStart.disabled = false;
        btnRecordStop.disabled = true;
    } catch (error) {
        console.error("[RECORD] Stop failed:", error);
    }
});

/* =========================================================
   CONNECT / DISCONNECT (WebRTC WHEP)
   ========================================================= */

btnConnect.addEventListener("click", () => {
    if (streamView.isStreamConnected()) {
        disconnect();
    } else {
        connect();
    }
});

async function disconnect() {
    if (streamView.isRecording()) {
        await streamView.recordStop();
    }

    btnRecordStart.disabled = true;
    btnRecordStop.disabled = true;

    streamView.disconnectStreamAndTakeSnapshot();

    stopMonitorStreamStats();
    setConnectButton("disconnected");
}

function connect() {
    stopMonitorStreamStats();

    const baseUrl = getStreamURL();

    if (!baseUrl) {
        console.error("Stream URL can not be empty");
        setConnectButton("disconnected");
        return;
    }

    setConnectButton("connecting");
    streamView.connectStream(baseUrl);
}

/* =========================================================
   PAGE UNLOAD
   ========================================================= */

window.addEventListener("beforeunload", () => {
    if (streamView.isRecording()) {
        streamView.recordStop();
    }
});