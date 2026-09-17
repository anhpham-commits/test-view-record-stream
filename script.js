import "./style.css"
import LeanbotFarmRunStreamView from "./@tools/tools-read-stream/tools-read-stream.js";

/* =========================================================
   DOM & INSTANCES
   ========================================================= */

const btnConnect = document.getElementById("btnConnect");
const statsButton = document.getElementById("statsButton");
const btnRecordStart = document.getElementById("btnRecordStart");
const btnRecordStop = document.getElementById("btnRecordStop");
const btnPreview = document.getElementById("btnPreview");

btnRecordStart.disabled = true;
btnRecordStop.disabled = true;
btnPreview.disabled = true;

const streamView = new LeanbotFarmRunStreamView("video", {
    controls: true,
    autoplay: true,
    muted: true,
    playsinline: true
});

/* =========================================================
   STATE & STREAM CALLBACKS
   ========================================================= */

streamView.onStreamConnect = () => {
    setConnectButton("connected");
    btnRecordStart.disabled = false;
    btnRecordStop.disabled = true;
    statsButton.disabled = false;
};

streamView.onStreamConnectError = () => {
    setConnectButton("disconnected");
    btnRecordStart.disabled = true;
    btnRecordStop.disabled = true;
    statsButton.disabled = true;
    streamView.hideQualityPopup();
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

statsButton.addEventListener("click", () => {
    if (streamView.isQualityPopupVisible()) {
        streamView.hideQualityPopup();
    } else {
        streamView.showQualityPopup();
    }
});

/* =========================================================
   RECORDING
   ========================================================= */

btnRecordStart.addEventListener("click", async () => {
    btnRecordStart.disabled = true;
    btnPreview.disabled = true;
    await streamView.recordStart();
    btnRecordStop.disabled = false;
});

btnRecordStop.addEventListener("click", async () => {
    await streamView.recordStop();
    btnRecordStart.disabled = false;
    btnRecordStop.disabled = true;
    btnPreview.disabled  = false;
});

btnPreview.addEventListener("click", async () => {
    streamView.showPreview();
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
    statsButton.disabled = true;

    streamView.hideQualityPopup();
    streamView.disconnectStreamAndTakeSnapshot();
    setConnectButton("disconnected");
}

function connect() {
    const baseUrl = getStreamURL();

    if (!baseUrl) {
        console.error("Stream URL can not be empty");
        setConnectButton("disconnected");
        return;
    }

    statsButton.disabled = true;
    streamView.hideQualityPopup();
    setConnectButton("connecting");
    streamView.connectStream(baseUrl);
}

/* =========================================================
   PAGE UNLOAD
   ========================================================= */

globalThis.addEventListener("beforeunload", () => {
    if (streamView.isRecording()) {
        streamView.recordStop();
    }
});