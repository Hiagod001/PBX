const net = require("node:net");

function requestQueueCapture(queue, channel, target) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection("/run/asterisk/pbx-queue-capture.sock");
    let response = "";
    socket.setEncoding("utf8");
    socket.setTimeout(8500, () => socket.destroy(new Error("Capture timed out")));
    socket.on("connect", () => socket.end(JSON.stringify({ queue, channel, target }) + "\n"));
    socket.on("error", reject);
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("end", () => resolve(response.trim()));
  });
}

module.exports = { requestQueueCapture };
