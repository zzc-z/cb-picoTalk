/*
 * Copyright (c) 2020 Thomas Kramer.
 *
 * This file is part of picoTalk 
 * (see https://codeberg.org/tok/picotalk).
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

version = [0, 0, 18]

// Load configuration from config.json.
fetch("config.json")
  .then(response => response.json())
  .then(json => console.log(json));


var default_websocket_port = 9998

// Set server in GUI.
document.getElementById("server_name").value = document.location.hostname + ":" + default_websocket_port;

var sample_rate = 16000
var frame_size = 512 // Number of samples in an audio frame.
var server_id = 1

// Tell if microphone is muted or not.
var muted = false

// Define logging functions.
function log(str) {
    const logElement = document.querySelector('#log');
    logElement.innerHTML += '<li>' + str + '</li>';
}

// Define logging functions.
debug = (str) => {console.log("DEBUG: " + str)}
info = (str) => {var str = "INFO: " + str; log(str);}
warning = (str) => {str = "WARNING: " + str; log(str);}
error = (str) => {str = "ERROR: " + str; log(str); alert(str)}

// Concatenate two typed arrays such as UInt8Arrays.
function concatTypedArray(a, b) {
    var c = new (a.constructor)(a.length + b.length);
    c.set(a, 0);
    c.set(b, a.length);
    return c;
}

// Convert a byte array into a hex-string.
function hex(byteArray) {
  return Array.from(byteArray, function(byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('')
}

// Convert a byte array to a string.
function bytes2str(str) {
    var text_dec = new TextDecoder()
    return text_dec.decode(str)
}

// Convert a string to a byte array.
function str2bytes(bytes) {
    var text_enc = new TextEncoder()
    return text_enc.encode(bytes)
}

// Convert a UInt8Array to an ArrayBuffer.
function uint8ArrayToBuffer(array) {
    return array.buffer.slice(array.byteOffset, array.byteLength + array.byteOffset)
}

// Default hash function.
// For now this is the first 256 bits of the SHA512 hash.
function hash(bytes) {
    return nacl.hash(bytes).slice(0, 32)
}

// Asynchronous FIFO queue.
class Queue {
    constructor(maxsize=0) {
        this.maxsize=maxsize
        this.fifo = []
        this.get_resolve_callbacks = []
        this.put_resolve_callbacks = []
    }

    // Return the number of elements currently in the queue.
    qsize() {
        return this.fifo.length
    }

    // Check if the queue is full.
    is_full() {
        return !(this.qsize() == 0 || this.qsize() < this.maxsize)
    }

    // Check if the queue is empty.
    is_empty() {
        return this.qsize() == 0
    }

    // Put an element without waiting. This throws an exception if the queue is full.
    put_nowait(obj) {

        if (this.is_full()) {
            throw "Queue is full!"
        }

        // Store the object.
        this.fifo.push(obj)
        // Notify the callback, if there is any waiting.
        if (this.get_resolve_callbacks.length > 0) {
            var callback = this.get_resolve_callbacks.shift()
            var obj = this.fifo.shift()
            callback(obj)
        }
    }

    // Put an element or wait for space to be freed if the queue is full.
    async put(obj) {
        if (!this.is_full()) {
            // No need to wait for space to be freed.
            this.put_nowait(obj)
        } else {
            var p = new Promise((resolve, reject) => {
                this.put_resolve_callbacks.push(resolve);
            });
            await p
        }
    }

    // Get an element without waiting. This throws an exception if the queue is empty.
    get_nowait() {

        if (this.is_empty()) {
            throw "Queue is empty!"
        }

        var obj = this.fifo.shift() // Get oldest element.
        // Notify the callback, if there is any waiting.
        if (this.put_resolve_callbacks.length > 0) {
            var callback = this.get_resolve_callbacks.shift()
            callback()
        }
        return obj
    }

    // Get an element or wait for one to arrive if the queue is empty.
    async get() {
        if (this.qsize() > 0) {
            return this.get_nowait() // Remove and return the oldest element.
        }
        // FIFO is empty, have to wait until an object is put into the queue.
        var p = new Promise((resolve, reject) => {
            this.get_resolve_callbacks.push(resolve);
        });
        return p
    }
}

// Constants for packet types.
PacketTypeAudioFrame = 1
PacketTypeJSON = 2
PacketTypeBinary = 3

// A type-length-value encoded packet.
class Packet {
    constructor(type, arraybuffer, src_addr = 0, dest_addr = 0) {
        this.type = type
        this.length = arraybuffer.byteLength
        this.src_addr = src_addr
        this.dest_addr = dest_addr
        this.data = arraybuffer
    }

    // Decode data as a UTF-8 string.
    dataAsString() {
        return bytes2str(this.data)
    }

    dataAsUint8() {
        return new Uint8Array(this.data)
    }

    static createJson(obj) {
        var json = JSON.stringify(obj)
        var data = str2bytes(json)

        var p = new Packet(PacketTypeJSON, data)
        return p
    }

    // Parse to JSON.
    toJson() {
        var str = this.dataAsString()
        return JSON.parse(str)
    }

    // Encode as an ArrayBuffer.
    encode() {
        var total_length = 7 + this.data.byteLength
        var buf = new ArrayBuffer(total_length)
        var d = new DataView(buf)

        d.setUint8(0, this.type)
        d.setUint16(1, this.data.byteLength)
        d.setUint16(3, this.src_addr)
        d.setUint16(5, this.dest_addr)

        // Copy data into the buffer.
        var u = new Uint8Array(buf)
        u.set(new Uint8Array(this.data), 7)

        return buf
    }

    // Encode as an UInt8Array.
    encodeAsUint8Array() {
        return new Uint8Array(this.encode())
    }
}

// Parse an ArrayBuffer into a packet.
function parsePacket(arraybuffer) {
    var msg = new DataView(arraybuffer)
    var type = msg.getUint8(0)
    var length = msg.getUint16(1)
    var src_addr = msg.getUint16(3)
    var dest_addr = msg.getUint16(5)
    var data = arraybuffer.slice(7)

    var p = new Packet(type, data, src_addr, dest_addr)
    return p
}

// Secure channel implementation on top of NaCl secretbox.
class SecureConnection {
    constructor(secretKey, conn, is_initiator, nonce, permit_dropped_packets = false) {
        this.secretKey = secretKey
        this.conn = conn

        // Initiator and responder must be distinguished to avoid packet mirroring attacks.
        this.__role = is_initiator ? 1 : 2
        this.__role_other = is_initiator ? 2 : 1

        // Counters are used to generate nonces.
        this.__counter = 1
        this.__counter_other = 1

        // assert 0 <= nonce < 256
        this.__nonce = nonce

        this.permit_dropped_packets = permit_dropped_packets
    }

    // Create a 24 byte nonce.
    _create_nonce(connection_id, role, counter) {
        var nonce = new Uint8Array(24)
        var d = new DataView(nonce.buffer)
        d.setUint8(0, connection_id)
        d.setUint8(1, role)
        d.setUint32(2, 0) // TODO: Emulate 64 bit counter
        d.setUint32(6, counter & 0xFFFFFFFF)
        return nonce
    }

    // Read single values back from the nonce.
    _parse_nonce(nonce) {
        var d = new DataView(nonce)
        return {
            connection_id: d.getUint8(0),
            role: d.getUint8(1),
            counter: (d.setUint32(2) << 32) + d.setUint32(6)
        }
    }

    // Encrypt the packet and send it over the underlying connection.
    async sendPacket(packet) {
        // Assemble nonce.
        var nonce = this._create_nonce(this.__nonce, this.__role, this.__counter)
        // Encrypt the packet.
        var data_encrypted = nacl.secretbox(packet.encodeAsUint8Array(), nonce, this.secretKey)
        // Nonce does not get appended automatically.

//     TODO: NOT YET IMPLEMENTED.
//        if self.permit_dropped_packets:
//            # Prepend the counter.
//            counter_bytes = struct.pack(">Q", self.__counter)
//            assert len(counter_bytes) == 8
//            data_encrypted = counter_bytes + data_encrypted
//
        var p_encrypted = new Packet(PacketTypeBinary, data_encrypted)
        this.__counter += 1 // Increment nonce after encryption.

        // Forward encrypted packet to underlying connection.
        await this.conn.sendPacket(p_encrypted)
    }

    // Receive packets from the underlying connection and try to decrypt them.
    // The first packet that successfully decrypts is returned.
    async receivePacket() {

        while(true) {
            // Try to receive and decrypt a packet.
            var p_encrypted = await this.conn.receivePacket()
            var counter = this.__counter_other

//          // TODO: NOT IMPLEMENTED
//                if self.permit_dropped_packets:
//                    # Strip away the counter.
//                    counter_bytes, data = data[:8], data[8:]
//                    counter_received, = struct.unpack(">Q", counter_bytes)
//                    # Make sure the counter is monotonic.
//                    counter = max(counter_received, self.__counter_other)
//
//                nonce = self.__create_nonce(self.__nonce, self.__role_other, counter)
            var nonce = this._create_nonce(this.__nonce, this.__role_other, counter)
            // Decrypt the packet.
            var data = p_encrypted.dataAsUint8()
            var decrypted = nacl.secretbox.open(data, nonce, this.secretKey)
            if (!decrypted) {
                warning("Packet decryption failed. Dropping packet.")
            } else {
                decrypted = uint8ArrayToBuffer(decrypted)
                var p = parsePacket(decrypted)

                // Monotonically increase the counter.
                this.__counter_other = counter + 1  // Compute next nonce on successful decryption.
                return p
            }
        }
    }
}

// Perform a triple DH key exchange.
// TODO: Add argument for the public identity key of the other party.
// conn: Packet oriented connection.
async function authenticatedKeyExchange(conn) {
    // Generate ephemeral client key pair.
    keyPairIdentity = nacl.box.keyPair() // Don't use fixed identities for now.
    keyPairEphemeral = nacl.box.keyPair()
    debug("Public ephemeral key: " + hex(keyPairEphemeral.publicKey))
    debug("Public identity key: " + hex(keyPairIdentity.publicKey))

    // Send client-key message.
    pubKeys = concatTypedArray(keyPairIdentity.publicKey, keyPairEphemeral.publicKey)
    p = new Packet(PacketTypeBinary, pubKeys)
    await conn.sendPacket(p)

    // Receive server-key message
    msg = await conn.receivePacket()
    if (msg.data.byteLength != 64) {
        error("Wrong public key length!")
        return
    }
    public_identity_key_other = msg.dataAsUint8().slice(0, 32)
    public_key_other = msg.dataAsUint8().slice(32, 64)
    info("Server identity key: " + hex(public_identity_key_other))

    // TODO: Check identity key.

    // Derive shared key.
    debug("Derive shared keys.")
    var shared1 = nacl.box.before(public_key_other, keyPairIdentity.secretKey);
    var shared2 = nacl.box.before(public_identity_key_other, keyPairEphemeral.secretKey);
    var shared3 = nacl.box.before(public_key_other, keyPairEphemeral.secretKey);

    shared_secret = hash(concatTypedArray(concatTypedArray(shared1, shared2), shared3))
    debug("Shared secret: " + hex(shared_secret))

    return shared_secret
}


// Test if the NaCl library is loaded.
if (typeof nacl === 'undefined') {
    error("NaCl library is not loaded.")
}

async function run(websocket_url, room_name) {

    // Open the WebSocket.
    queue_from_server = new Queue()

    info("Connecting to WebSocket: " + websocket_url)
    var sock = new WebSocket(websocket_url)
    sock.binaryType = "arraybuffer"

    // Send a message.
    sock.onopen = function (event) {
      debug("WS Connected!")
    };

    // Receive a message.
    sock.onmessage = function (event) {
        queue_from_server.put_nowait(event.data)
    }

    sock.onerror = function (event) {
        error(`WS Error: ${event.message}`)
        error("Cannot connect to " + websocket_url)
    }

    sock.onclose = function(event) {
        debug("WS closed.")
    }

    /// Send a packet over the WebSocket.
    async function sendPacket(p) {
        var data = p.encode()
        sock.send(data)
    }

    // Receive an ArrayBuffer from the WebSocket.
    async function receiveBytes() {
        return await queue_from_server.get()
    }

    /// Receive a Packet from the WebSocket.
    async function receivePacket() {
        return parsePacket(await receiveBytes())
    }


    var conn_plain = {
        receivePacket: receivePacket,
        sendPacket: sendPacket
    }

    // Receive server-hello message.
    p = await conn_plain.receivePacket()
    json = p.toJson()
    // Check version for compatibility.
    if (version.toString() != json.version.toString()) { // Cannot compare arrays, so have to convert to string.
        log(`Server version ${json.version} is incompatible with client version ${version}.`)
        sock.close()
        return
    }

    // Perform key-exchange.
    shared_secret = await authenticatedKeyExchange(conn_plain)
    // Open secure connection to the server.
    var conn = new SecureConnection(shared_secret, conn_plain, true, 1, false)

    info("Room name: " + room_name)
    // Derive room ID.
    var room_id = hex(hash(str2bytes(room_name)))
    debug("Room ID: " + room_id)

    // Write encrypted client-hello message.
    debug('Send client-hello message.')
    var p = Packet.createJson({room_id: room_id})
    await conn.sendPacket(p)

    // Wait for accept-message.
    debug("Wait for server-accept message.")
    var p = await conn.receivePacket()
    var msg = p.toJson()
    debug("Server-accept message: " + JSON.stringify(msg))
    var user_id = msg.user_id
    info("User ID: " + user_id)

    // Tell server not to use UDP.
    var p = Packet.createJson({use_udp: false})
    await conn.sendPacket(p)

    async function receive_from_server(receivePacket, audio_queue) {
        debug("Start receiver task.")
        while (true) {
            var p = await receivePacket()

            if (p.type == PacketTypeAudioFrame) {
//                info("Received an audio frame.")
                if (audio_queue.is_full()) {
                    // Drop the oldest packet.
                    audio_queue.get_nowait()
                }
                audio_queue.put_nowait(p)
            } else {
                info("Received a control packet: " + p.dataAsString())
            }
        }
    }

    var audio_queue = new Queue(maxsize=4)
    async function rx() {
        return await conn.receivePacket()
    }

    // Start receiver task.
    receive_from_server(rx, audio_queue)

    async function run_speaker(audio_queue) {
        var audioContext = new (window.AudioContext || window.webkitAudioContext)({sampleRate:16000});

        var bufferSize = 512;
        var whiteNoise = audioContext.createScriptProcessor(bufferSize, 1, 1);
        whiteNoise.onaudioprocess = function(e) {
            var output = e.outputBuffer.getChannelData(0);
            for (var i = 0; i < bufferSize; i++) {
                output[i] = 0;
            }
            if (!audio_queue.is_empty()) {
                var packet = audio_queue.get_nowait()

                var audio = new Int16Array(packet.data)
                for (var i = 0; i < bufferSize; i++) {
                    output[i] = audio[i] *1.0/ (1<<15);
                }
            }
        }

        whiteNoise.connect(audioContext.destination);
    }

    // Start speaker task.
    run_speaker(audio_queue)

    // Get data from the microphone and send audio packets though `sendPacket`.
    async function run_microphone(sendPacket) {
        info("Start microphone task.")

        var constraints = {
                audio: {
                    // Constraints seem to have little effect in Firefox.
                    sampleRate: 16000,
                    sampleSize: 16,
                    echoCancellation: true,
                    autoGainControl: true,
                    noiseSuppression: true
                }
            }

        try {
            debug("Try to open media stream.")
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            info("Microphone stream sample rate: " + stream.sampleRate)
            debug("Media stream opened: " + stream)
            /* use the stream */

            var audioContext = new (window.AudioContext || window.webkitAudioContext)() // ({sampleRate:16000})

            audioInput = audioContext.createMediaStreamSource(stream);

            recorder = audioContext.createScriptProcessor(1024, 1, 1);

            // Create empty buffer.
            var bufferResampled = new Float32Array(0)

            recorder.onaudioprocess = function (e) {
                if (muted) {
                    return
                }

                ////// START RESAMPLE
                // Resample the audio signal and fill it into the buffer.
                // From https://stackoverflow.com/questions/27598270/resample-audio-buffer-from-44100-to-16000
                var sourceAudioBuffer = e.inputBuffer;  // directly received by the audioprocess event from the microphone in the browser

                var TARGET_SAMPLE_RATE = sample_rate;
                var offlineCtx = new OfflineAudioContext(sourceAudioBuffer.numberOfChannels,
                     sourceAudioBuffer.duration * sourceAudioBuffer.numberOfChannels * TARGET_SAMPLE_RATE,
                     TARGET_SAMPLE_RATE
                     )
                var audioBuffer = offlineCtx.createBuffer(sourceAudioBuffer.numberOfChannels,
                    sourceAudioBuffer.length,
                    sourceAudioBuffer.sampleRate)
                // Copy the source data into the offline AudioBuffer
                for (var channel = 0; channel < sourceAudioBuffer.numberOfChannels; channel++) {
                    audioBuffer.copyToChannel(sourceAudioBuffer.getChannelData(channel), channel)
                }
                // Play it from the beginning.
                var source = offlineCtx.createBufferSource()
                source.buffer = sourceAudioBuffer
                source.connect(offlineCtx.destination)
                source.start(0)

                offlineCtx.oncomplete = function(e) {
                    // `resampled` contains an AudioBuffer resampled at 16000Hz.
                    // use resampled.getChannelData(x) to get an Float32Array for channel x.
                    var resampled = e.renderedBuffer;
                    var leftFloat32Array = resampled.getChannelData(0);
                    // Use this float32array to send the samples to the server or whatever.
                    bufferResampled = concatTypedArray(bufferResampled, leftFloat32Array)
                }

                offlineCtx.startRendering();

                ////// END RESAMPLE

                // Dispatch audio frames, convert them to Int16 arrays and send them as packets to the server.
                while (bufferResampled.length >= frame_size) {
                    frame = bufferResampled.slice(0, frame_size)

                    // Convert float values to int16.
                    var intAudio = new Int16Array(frame.length)
                    for (var j = 0; j < frame.length; j++) {
                        intAudio[j] = Math.round(frame[j] * (1<<15))
                    }

                    // Put the audio frame into a packet and send it.
                    var p = new Packet(PacketTypeAudioFrame, intAudio.buffer, src_addr=0, dest_addr=server_id)
                    sendPacket(p)
                    bufferResampled = bufferResampled.slice(frame_size)
                }
            }

            audioInput.connect(recorder);
            recorder.connect(audioContext.destination);

        } catch(err) {
            /* handle the error */
            error("Error opening the media stream: " + err)
        }

    }

    // Start microphone task.
    async function tx(p) {
        return await conn.sendPacket(p)
    }
    run_microphone(tx)
}

// Start the client program.

const btnConnect = document.getElementById('btn_connect');

btnConnect.addEventListener('click', async () => {
    btnConnect.setAttribute('disabled', true)
    var host = document.getElementById("server_name").value
    var websocket_url = 'ws://' + host + '/ws'
    var room_name = document.getElementById("room_name").value
    run(websocket_url, room_name);
})

// Setup microphone-mute button.
const btnToggleMute = document.getElementById('btnToggleMute');

function setMuted(is_muted) {
    muted = is_muted
    if (muted) {
        info("You are now muted.")
        btnToggleMute.innerHTML = "Unmute"
    } else {
        info("You are now unmuted.")
        btnToggleMute.innerHTML = "Mute"
    }
}

setMuted(false)

btnToggleMute.addEventListener('click', async () => {
    setMuted(!muted)
})

// Setup show-log button.
const btnShowLog = document.getElementById('btnShowLog');
const divLog = document.getElementById('divLog')

var showLog = false

function setShowLog(_showLog) {
    showLog = _showLog
    if (showLog) {
        divLog.style.display = "block"
        btnShowLog.innerHTML = "Hide Log"
    } else {
        divLog.style.display = "none"
        btnShowLog.innerHTML = "Show Log"
    }
}

setShowLog(false)

// Toggle the log.
btnShowLog.addEventListener('click', async () => {
    setShowLog(!showLog)
})