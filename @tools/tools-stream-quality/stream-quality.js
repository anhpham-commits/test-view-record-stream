import "./stream-quality.css";
import html from "./stream-quality.html";

export class StreamStats {
    constructor() {
        this.inbound_rtp = null;
    }

    reset() {
        this.inbound_rtp = null;
    }

    measure(stats) {
        let current_inbound;

        stats.forEach(report => {
            if (report.type === "inbound-rtp" && report.kind === "video") {
                current_inbound = report;
            }
        });

        if (!this.inbound_rtp) {
            this.inbound_rtp = current_inbound;
            return null;
        }

        const prev = this.inbound_rtp;

        const timeDelta = (current_inbound.timestamp - prev.timestamp) / 1000;
        const bytesDelta = current_inbound.bytesReceived - prev.bytesReceived;
        const packetsLostDelta = current_inbound.packetsLost - prev.packetsLost;
        const packetsReceivedDelta = current_inbound.packetsReceived - prev.packetsReceived;
        const framesDecodedDelta = current_inbound.framesDecoded - prev.framesDecoded;

        const bitrate = ((bytesDelta * 8) / timeDelta / 1000);

        const packetLoss = packetsLostDelta / (packetsLostDelta + packetsReceivedDelta);

        const jitter = current_inbound.jitter * 1000;

        const framesDecodedPerSecond = framesDecodedDelta / timeDelta;

        const isFrozen = bitrate > 10 && framesDecodedDelta === 0;

        const result = {
            timeDelta,
            bitrate,
            packetLoss,
            jitter,
            framesDecodedPerSecond,
            isFrozen,

            frameWidth: current_inbound.frameWidth,
            frameHeight: current_inbound.frameHeight,

            framesDropped_cumulative: current_inbound.framesDropped,
            freezeCount_cumulative: current_inbound.freezeCount,
            totalFreezesDuration_cumulative: current_inbound.totalFreezesDuration,
            framesDecoded_cumulative: current_inbound.framesDecoded,
            packetsReceived_cumulative: current_inbound.packetsReceived,
            packetsLost_cumulative: current_inbound.packetsLost,
            bytesReceived_cumulative: current_inbound.bytesReceived
        };

        this.inbound_rtp = current_inbound;

        return result;
    }

    format(result) {
        if (!result) return "No result";
        // Direct values (from report / cumulative) first
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

        // Derived / interval values below, separated by a blank line
        const derived = [
            `timeDelta: ${result.timeDelta.toFixed(3)} s`,
            `bitrate: ${result.bitrate.toFixed(3)} Kbps`,
            `packetLoss: ${result.packetLoss}`,
            `framesDecodedPerSecond: ${result.framesDecodedPerSecond.toFixed(3)} fps`,
            `isFrozen: ${result.isFrozen}`
        ];

        return direct.concat([""], derived).join("\n");
    }
}

export default class StreamQuality {

    #modal;
    #content;
    #closeButton;
    #_stats;

    constructor() {

        // Luôn xóa popup cũ nếu còn
        document.getElementById("streamQualityModal")?.remove();

        // Tạo popup
        document.body.insertAdjacentHTML("beforeend", html);

        this.#modal =
            document.getElementById("streamQualityModal");

        this.#content =
            document.getElementById("streamQualityContent");

        this.#closeButton =
            document.getElementById("streamQualityClose");

        // Close button
        this.#closeButton.onclick = () => {
            this.hide();
        };

        // Click ra ngoài popup để đóng
        this.#modal.onclick = (event) => {
            if (event.target === this.#modal) {
                this.hide();
            }
        };

        // Mặc định ẩn
        this.hide();
        this.#_stats = new StreamStats();
    }


    show() {
        this.#modal.style.display = "flex";
        document.body.style.overflow = "hidden";
    }


    hide() {
        this.#modal.style.display = "none";
        document.body.style.overflow = "";
    }


    update(result) {
        this.#content.textContent = result
    }

    updateFromStats(stats) {
        const result = this.#_stats.measure(stats);
        const formatted = this.#_stats.format(result);
        this.update(formatted);
        return formatted;
    }

    resetStats() {
        this.#_stats.reset();
    }


    showResult(result) {
        this.update(result);
        this.show();
    }


    clear() {
        this.#content.textContent = "";
    }

    isVisible() {
        return this.#modal.style.display === "flex";
    }
}

