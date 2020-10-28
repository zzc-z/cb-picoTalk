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



const version = [0, 0, 20]

const sample_rate = 16000 // Audio sample rate.
const frame_size = 512 // Number of samples in an audio frame.
const sample_size = 2 // Size of a sample in bytes.
const server_id = 1


// Define logging functions.
function log(str) {
    const logElement = document.querySelector('#log')
    var listNode = document.createElement('li')
    listNode.textContent = str
    logElement.appendChild(listNode)

    // Scroll to bottom.
    logElement.scrollTop = logElement.scrollHeight
}

// Define logging functions.
debug = (str) => {console.debug("DEBUG: " + str)}
info = (str) => {var str = "INFO: " + str; console.info(str); log(str);}
warning = (str) => {str = "WARNING: " + str; console.warn(str); log(str);}
error = (str) => {str = "ERROR: " + str; console.error(str); log(str); alert(str)}

function assert(assertion, msg) {
    console.assert(assertion, msg)
}

// Test if the NaCl library is loaded.
if (typeof nacl === 'undefined') {
    error("NaCl library is not loaded.")
}


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

// Convert a hex-string into a Uint8Array.
function parseHex(str) {
    var result = [];
    while (str.length >= 2) {
        result.push(parseInt(str.substring(0, 2), 16));
        str = str.substring(2, str.length);
    }

    return new Uint8Array(result);
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

// Generate a pseudo-random sequence of Int16 that can be used to encrypt
// an audio frame by element-wise addition.
// length = Number of Int16
function generate_key_stream(key, peer_id, counter, length) {

    // Create the nonce.
    var nonce = new Uint8Array(24)
    var d = new DataView(nonce.buffer)
    d.setUint16(0, peer_id)
    d.setUint32(2, counter)

    // Construct key stream.
    var zeros = new Uint8Array(length*2) // TODO: Explicitly fill with zeros?
    var key_stream = nacl.secretbox(zeros, nonce, key) // Encrypt the zero bytes to gain the keystream.

    // Cut away the authenticator.
    key_stream = key_stream.slice(16)

    // Convert to Int16Array.
    var key_stream_buffer = uint8ArrayToBuffer(key_stream)
    var key_signal = new Int16Array(key_stream_buffer)

    return key_signal
}

function encrypt_audio_frame(frame, key, peer_id, counter) {
    var key_signal = generate_key_stream(key, peer_id, counter, frame.length)
    var encrypted = new Int16Array(frame.length)
    for (var i = 0; i < frame.length; i++) {
        encrypted[i] = frame[i] + key_signal[i]
    }
    return encrypted
}

function decrypt_audio_frame(frame, key, peer_id, counter) {
    var key_signal = generate_key_stream(key, peer_id, counter, frame.length)
    var decrypted = new Int16Array(frame.length)
    for (var i = 0; i < frame.length; i++) {
        decrypted[i] = frame[i] - key_signal[i]
    }
    return decrypted
}

// Constants for packet types.
const PacketTypeAudioFrame = 1
const PacketTypeJSON = 2
const PacketTypeBinary = 3

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

// Parse a (peer_id, nonce) audio tag that is appended to the audio frame.
function parseAudioTag(arraybuffer, offset) {
    var v = new DataView(arraybuffer)
    var peer_id = v.getUint16(offset + 0)
    var nonce = v.getUint32(offset + 2)
    return {peer_id: peer_id, nonce: nonce}
}

// Return a ArrayBuffer containing the serialized audio tag.
function encodeAudioTag(peer_id, counter) {
    var buf = new ArrayBuffer(6)
    var d = new DataView(buf)
    d.setUint16(0, peer_id)
    d.setUint32(2, counter)
    return buf
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

        assert(0 <= nonce, "Nonce out of range.")
        assert(nonce < 256, "Nonce out of range.")
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
    debug("Shared secret: " + hex(shared_secret.slice(0, 4)) + "...")

    return shared_secret
}

// SPEKE: Simple password exponential key exchange.
class SPEKE {

    constructor(password, salt = new Uint8Array(0)) {
        // Compute base point from the hashed password: p = H(password)
        var p = hash(password)

        this.generator = p
        this.__private_key = null
    }

    //  Generate fresh key pair based on password.
    //  This key pair can be used for at most one key exchange.
    generate_public_key() {
        this.__private_key = nacl.randomBytes(32)
        var public_key = nacl.scalarMult(this.__private_key, this.generator)
        return public_key
    }

    //  Compute a shared secret based on another public key.
    //  This can be called only once after creating a new key pair.
    compute_shared_key(other_public) {
        if (this.__private_key === null) {
            throw "Must call `generate_public_key() first."
        }
        var s = nacl.scalarMult(this.__private_key, other_public)
        // Make sure this secret kehy is only used once.
        this.__private_key = null // TODO: Wipe the key!

        // Compute the hash of the shared secret.
        var s_hashed = hash(s)

        return s_hashed
    }
}

//  Do a password authenticated key exchange to derive a shared secret key.
//  :param conn: Underlying insecure connection.
async function password_authenticated_key_exchange(conn, password) {
    var speke = new SPEKE(password)

    var public_key = speke.generate_public_key()

    // Send key message.
    debug("SPEKE: Send public key.")
    var tx = conn.sendPacket(new Packet(PacketTypeBinary, public_key))

    // Receive public key message.
    debug("SPEKE: Receive public key.")
    var rx = conn.receivePacket()

    await tx
    var msg = await rx

    if (msg.type != PacketTypeBinary) {
        throw "Wrong message type: " + msg.type
    }
    if (msg.length != 32) {
        throw "Wrong public key length."
    }

    var public_key_other = msg.dataAsUint8()

    var shared_secret = speke.compute_shared_key(public_key_other)

    return shared_secret
}

//Data structure for another peer.
class Peer {

    constructor(peer_id, send_packet_fn, password, is_initiator) {
        this.msg_queue_in = new Queue() // Queue for incoming messages from this peer.
        this.peer_id = peer_id
        this.password = password
        this.peer_name = null
        this.audio_encryption_key = null

        this.send_packet_fn = send_packet_fn

        // Receive packet from peer.
        var _msg_queue = this.msg_queue_in
        async function rx() {
            return await _msg_queue.get()
        }

        // Send packet to peer.
        async function tx(p) {
            p.dest_addr = peer_id // Set destination address.
            await send_packet_fn(p)
        }

        // Connection via server (not E2EE).
        this.conn_server = {
            receivePacket: rx,
            sendPacket: tx
        }

        this.conn_e2ee = this.run_key_exchange(password, is_initiator)
        this.run() // TODO Also terminate this somewhen.
    }

    // Send and address a packet to the server.
    async send_to_server(p) {
        p.dest_addr = server_id
        await this.send_packet_fn(p)
    }

//
//    def close(self):
//        """
//        Close this peer connection.
//        """
//        pass

    // Process incoming packets from other peers.
    async run() {
        var conn = await this.conn_e2ee
        while (true) {
            var p = await conn.receivePacket()
            debug("Got E2EE packet from peer: " + p.dataAsString())

            if (p.type == PacketTypeJSON) {
                var d = p.toJson()
                if ('user_name' in d) {
                    this.peer_name = d.user_name
                    info("User set her name: " + this.peer_name)
                    gui_add_peer(this.peer_id, this.peer_name)
                }
                if ('chat_message' in d) {
                   var msg = d.chat_message
                   log("Chat message from " + this.peer_name + ": " + msg)
                   gui_display_chat_message(this.peer_name, msg)
                }
                if ('audio_encryption_key' in d) {
                    // Receive the audio encryption key from the peer.
                    var hex_key = d.audio_encryption_key
                    debug(`Got audio encryption key from ${this.peer_id}: ${hex_key.substring(0, 8)}`)
                    var key = parseHex(hex_key)
                    this.audio_encryption_key = key
                }
            }
        }
    }

    // Send a Packet to the peer over the end-to-end encrypted channel.
    async send_to_peer(p) {
        var conn = await this.conn_e2ee
        await conn.sendPacket(p)
    }

    //  Run authenticated key exchange with other peer.
    //  If the key exchange is successfull the 'this.conn_e2ee' future will be set.
    async run_key_exchange(password, is_initiator) {
        debug("Start key exchange with peer " + this.peer_id)
        var shared_key = await password_authenticated_key_exchange(this.conn_server, password)
        debug("E2EE Shared secret: " + hex(shared_key.slice(0, 4)) + "...")

        var conn_e2ee = new SecureConnection(shared_key, this.conn_server, is_initiator, 0)

        // Check if the secure connection works.
        conn_e2ee.sendPacket(Packet.createJson({status: 'ok'}))
        var response = await conn_e2ee.receivePacket()
        console.log(response.dataAsUint8())
        var d = response.toJson()

        if (d.status == 'ok') {
            debug(`Key exchange successful with peer ${this.peer_id}.`)
            // Notify the server that the peer is authenticated.
            await this.send_to_server(Packet.createJson({event: 'peer_authenticated', peer_id: this.peer_id}))

            return conn_e2ee
        } else {
            warning(`Key exchange failed with peer ${this.peer_id}.`)
            return null
        }

        return conn_e2ee
    }

    async handle_packet_from_peer(p) {
        debug("Handle packet from peer " + p.src_addr)
        this.msg_queue_in.put_nowait(p)
    }
}

// Setup GUI elements.
var divPeerList = document.getElementById('divPeerList')
var ulPeerList = document.getElementById('peerList')
var inputChatMessage = document.getElementById('inputChatMessage')

// Display a peer on the GUI or change it's name.
function gui_add_peer(peer_id, name, is_authenticated) {
    var node = document.getElementById("peer_"+peer_id)
    if (node === null) {
        node = document.createElement("li")
        node.id = "peer_"+peer_id
        ulPeerList.appendChild(node)
    }

    node.textContent = name //+ ` (${peer_id})`
}

function gui_mark_peer_authenticated(peer_id) {
    var node = document.getElementById("peer_"+peer_id)
    if (node === null) {
        // TODO
    }
}

// Remove a displayed peer from the GUI.
function gui_remove_peer(peer_id) {
    var node = document.getElementById("peer_"+peer_id)
    if (node !== null) {
        node.remove()
    }
}

// Display a chat message.
function gui_display_chat_message(sender_name, msg) {
    var msglist = document.getElementById("chatMessages")
    var node = document.createElement("li")
    node.textContent = sender_name + ": " + msg
    msglist.appendChild(node)
    // Scroll to bottom.
    msglist.scrollTop = msglist.scrollHeight;
}

async function main() {

    // Load configuration from config.json.
    async function loadConfig() {
        var response = await fetch("config.json")
        var json = await response.json()
        return json
    }

    config = loadConfig()

    // Get a config value by key.
    async function getConfig(key, default_value=null) {
        debug("getConfig: " + key)
        var json = await config
        var value = json[key]
        if (!value) {
            return default_value
        } else {
            return value
        }
    }

    // Tell if microphone is muted or not.
    var muted = false

    async function run(websocket_url, room_name, room_password, user_name, on_success, on_error, on_close) {


        info("Password: " + room_password)
        info("User name: " + user_name)

        // Password for password authenticated key exchange.
        var password = str2bytes(room_password)

        // Other peers.
        var peers = {}

        // My own peer_id.
        // Will be set later.
        var my_peer_id = null

        // Generate audio encryption key.
        var my_audio_encryption_key = nacl.randomBytes(32)

        function get_audio_encryption_key_of_peer(peer_id) {

            if (peer_id == my_peer_id) {
                return my_audio_encryption_key
            }

            if (peer_id in peers) {
                return peers[peer_id].audio_encryption_key
            }
            return null
        }

        inputChatMessage.addEventListener("keyup", function(event) {
            // When enter is pressed.
            if (event.keyCode === 13) {
                // Cancel the default action, if needed
                event.preventDefault()
                var msg = inputChatMessage.value
                inputChatMessage.value = "" // Clear.
                debug("Send chat message: " + msg)
                gui_display_chat_message("Me", msg)
                for (var peer_id in peers) {
                    peers[peer_id].send_to_peer(Packet.createJson({chat_message: msg}))
                }
            }
        })

        // Open the WebSocket.
        var queue_from_server = new Queue()

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
            error("Cannot connect to " + websocket_url)
            on_error("Cannot connect to " + websocket_url)
        }

        sock.onclose = function(event) {
            debug("WS closed.")
            on_close()
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
        var p = await conn_plain.receivePacket()
        var json = p.toJson()
        // Check version for compatibility.
        if (version.toString() != json.version.toString()) { // Cannot compare arrays, so have to convert to string.
            log(`Server version ${json.version} is incompatible with client version ${version}.`)
            sock.close()
            return
        }

        // Perform key-exchange.
        var shared_secret = await authenticatedKeyExchange(conn_plain)
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
        my_peer_id = msg.user_id
        info("Peer ID: " + my_peer_id)

        // Tell server not to use UDP.
        var p = Packet.createJson({use_udp: false})
        await conn.sendPacket(p)

        async function handle_control_packet(p) {
            info("Received a control packet: " + p.dataAsString())

            if (p.src_addr == server_id) {
                // Packet comes from server.
                var json = p.toJson()

                if ('event' in json) {
                    var event = json.event
                    debug("Event = " + event)

                    if (event == 'peer_joined') {
                        var peer_id = json.peer_id
                        var name = `Anonymous (${peer_id})`
                        gui_add_peer(peer_id, name)

                        // Create new peer object.
                        if (peer_id in peers) {
                            warn(`Peer with ID ${peer_id} is already registered.`)
                        } else {
                            // Start connection to peer.
                            async function tx(p) {
                                conn.sendPacket(p)
                            }
                            var peer = new Peer(peer_id, tx, password, true)
                            peers[peer_id] = peer
                            // Send my user name and audio encryption key to the peer.
                            peer.send_to_peer(Packet.createJson({
                                    user_name: user_name,
                                    audio_encryption_key: hex(my_audio_encryption_key)
                                }))
                        }
                    } else if (event == 'peer_disconnected') {
                        var peer_id = json.peer_id
                        gui_remove_peer(peer_id)
                    } else if (event == 'peer_authenticated') {
                        var peer_id = json.peer_id
                        if (peer_id == my_peer_id) {
                            // I'm successfully authenticated.
                            on_success()
                        } else {
                            // Mark the peer as 'authenticated'.
                            debug("Peer is authenticated: " + peer_id)
                            gui_mark_peer_authenticated(peer_id)
                        }
                    }
                }
            } else {
                // Packet comes from another peer.
                var peer_id = p.src_addr
                info("Packet from another peer: " + peer_id)

                if (peer_id == 0) {
                    warning("src_addr == 0, drop packet")
                    return
                }

                if (!(peer_id in peers)) {
                    // Create peer object if none exists.
                    async function tx(p) {
                        conn.sendPacket(p)
                    }
                    var peer = new Peer(peer_id, tx, password, false)
                    peers[peer_id] = peer
                    // Send my user name and audio encryption key to the peer.
                    peer.send_to_peer(Packet.createJson({
                            user_name: user_name,
                            audio_encryption_key: hex(my_audio_encryption_key)
                        }))
                }
                var peer = peers[peer_id]
                // Pass the packet to the peer object.
                await peer.handle_packet_from_peer(p)
            }
        }

        async function receive_from_server(receivePacket, audio_queue) {
            debug("Start receiver task.")
            while (true) {
                var p = await receivePacket()

                if (p.type == PacketTypeAudioFrame) {
    //                info("Received an audio frame.")

                    var frame = new Int16Array(p.data.slice(0, frame_size*sample_size))
                    var tag_buffer = p.data.slice(frame_size*sample_size)

                    // Parse audio tags.
                    var tags = []
                    for (var i = 0; i < tag_buffer.byteLength; i+=6) {
                        var tag = parseAudioTag(tag_buffer, i)
                        tags.push(tag)
                    }

                    // Decrypt the frame.
                    for (const tag of tags) {
                        var peer_id = tag.peer_id
                        var key = get_audio_encryption_key_of_peer(peer_id)
                        if (key === null) {
                            // Can't decrypt the frame because the key is not known.
                            debug(`Encryption key not known for peer ${peer_id}.`)
                            // Frame with lower-volume noise.
                            for (var i = 0; i < frame.length; i+=1) {
                                frame[i] /= 16
                            }
                            break
                        }
                        frame = decrypt_audio_frame(frame, key, peer_id, tag.nonce)
                    }

                    if (audio_queue.is_full()) {
                        // Drop the oldest packet.
                        audio_queue.get_nowait()
                    }
                    audio_queue.put_nowait(frame)
                } else {
                    await handle_control_packet(p)
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
            debug("Start speaker task.")
            var audioContext = new (window.AudioContext || window.webkitAudioContext)({sampleRate:sample_rate});

            var bufferSize = frame_size;
            var scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
            scriptProcessor.onaudioprocess = function(e) {
                var output = e.outputBuffer.getChannelData(0);
                for (var i = 0; i < bufferSize; i++) {
                    output[i] = 0;
                }
                if (!audio_queue.is_empty()) {
                    var audio = audio_queue.get_nowait()
                    for (var i = 0; i < bufferSize; i++) {
                        output[i] = audio[i] *1.0/ (1<<15);
                    }
                }
            }

            scriptProcessor.connect(audioContext.destination);
        }

        // Start speaker task.
        run_speaker(audio_queue)

        // Get data from the microphone and send audio packets though `sendPacket`.
        async function run_microphone(sendPacket) {
            debug("Start microphone task.")

            var constraints = {
                    audio: {
                        // Constraints seem to have little effect in Firefox.
                        sampleRate: sample_rate,
                        sampleSize: 16,
                        echoCancellation: true,
                        autoGainControl: true,
                        noiseSuppression: true
                    }
                }

            try {
                debug("Try to open media stream.")
                stream = await navigator.mediaDevices.getUserMedia(constraints);
                debug("Media stream opened: " + stream)

                const audioContext = new (window.AudioContext || window.webkitAudioContext)() // ({sampleRate:16000})
                const mic_sample_rate = audioContext.sampleRate
                debug("Microphone stream sample rate: " + mic_sample_rate)
                var track = stream.getAudioTracks()[0]
                var track_settings = track.getSettings()
                debug("Audio track settings: " + JSON.stringify(track_settings))

                var audioInput = audioContext.createMediaStreamSource(stream);

                var recorder = audioContext.createScriptProcessor(4096, 1, 1);

                // Create empty buffers.
                var bufferOriginal = new Float32Array(0)
                var bufferResampled = new Float32Array(0)

                // Frame counter for generating the encryption nonce.
                var encryption_counter = 1

                recorder.onaudioprocess = function (e) {
                    if (muted) {
                        return
                    }

                    ////// START RESAMPLE
                    // Resample the audio signal and fill it into the buffer.
                    var sourceAudioBuffer = e.inputBuffer;  // directly received by the audioprocess event from the microphone in the browser
                    var samples = sourceAudioBuffer.getChannelData(0)
                    // Append frame to non-resampled buffer.
                    bufferOriginal = concatTypedArray(bufferOriginal, samples)

                    // Microphone sample rate is assumed to be a multiple of 100.
                    // Also the target sample rate is assumed to be a multiple of 100.
                    // Resampling is performed on a sliding window.
                    var resample_frame_size = mic_sample_rate / 100
                    // Resample frame by frame.
                    while (bufferOriginal.length >= resample_frame_size*2) {
                        // https://github.com/rochars/wave-resampler
                        var samples = bufferOriginal.slice(0, resample_frame_size*2)
                        // Resample!
                        var newSamples = waveResampler.resample(samples, mic_sample_rate, sample_rate);
                        newSamples = newSamples.slice(newSamples.length/4, newSamples.length/2 + newSamples.length/4)

                        // Append the resampled frame to the buffer.
                        bufferResampled = concatTypedArray(bufferResampled, newSamples)

                        // Remove the processed frame from the buffer.
                        bufferOriginal = bufferOriginal.slice(resample_frame_size)
                    }

                    // Dispatch audio frames, convert them to Int16 arrays and send them as packets to the server.
                    while (bufferResampled.length >= frame_size) {
                        frame = bufferResampled.slice(0, frame_size)

                        // Convert float values to int16.
                        var intAudio = new Int16Array(frame.length)
                        for (var j = 0; j < frame.length; j++) {
                            intAudio[j] = Math.round(frame[j] * (1<<15))
                        }

                        if (my_audio_encryption_key !== null) { // Don't send anything if the encryption key is not defined.

                            // Encrypt the audio frame.
                            var encryptedIntAudio = encrypt_audio_frame(intAudio, my_audio_encryption_key,
                                my_peer_id, encryption_counter)
                            var audio_tag = encodeAudioTag(my_peer_id, encryption_counter)
                            encryption_counter += 1 // Make sure the counter is never used twice.

                            // Append audio tag.
                            var data = concatTypedArray(new Uint8Array(encryptedIntAudio.buffer),
                                new Uint8Array(audio_tag)
                            )

                            // Put the audio frame into a packet and send it.
                            var p = new Packet(PacketTypeAudioFrame, data.buffer, src_addr=0, dest_addr=server_id)
                            sendPacket(p)
                            bufferResampled = bufferResampled.slice(frame_size)
                        }
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

    var divJoinRoomForm = document.getElementById('joinRoomForm')
    var divWaitForConnection = document.getElementById('waitToConnect')
    var divControlButtons = document.getElementById('controlButtons')
    var divJoinRoomConfirm = document.getElementById('joinRoomConfirm')
    var divChat = document.getElementById('divChat')

    var inputRoomName = document.getElementById("room_name")
    var inputPassword = document.getElementById("password")
    var inputUserName = document.getElementById("user_name")

    // Get URL parameters.
    // TODO: Inspect (from stackoverflow)
    var url_parameters = window.location.search.slice(1)
                      .split('&')
                      .reduce(function _reduce (/*Object*/ a, /*String*/ b) {
                        b = b.split('=');
                        a[b[0]] = decodeURIComponent(b[1]);
                        return a;
                      }, {});
    debug("URL parameters: " + JSON.stringify(url_parameters))

    var is_joining_room = 'room' in url_parameters

    if (is_joining_room) {
        divJoinRoomForm.style.display = 'none'
        divJoinRoomConfirm.style.display = 'flex'
    } else {
        divJoinRoomForm.style.display = 'flex'
    }

    // GUI setup.
    var default_server = await getConfig("default_server")
    debug("default_server = " + default_server)

    if (default_server === null) {
        default_server = document.location.hostname
    }

    var server_name = url_parameters['server'] || default_server
    debug("server_name = " + server_name)

    // Set room name.
    var random_room_name = hex(nacl.randomBytes(4))
    // Set a random room name as default if none was supplied in the URL.
    inputRoomName.value = url_parameters['room'] || random_room_name

    document.getElementById("joinRoomConfirmName").textContent = room_name.value
    document.getElementById("joinRoomConfirmServer").textContent = server_name

    // Set server in GUI.
    document.getElementById("server_name").value = server_name;

    const btnConnect = document.getElementById('btn_connect');

    btnConnect.addEventListener('click', async () => {
        var actual_server_name = document.getElementById("server_name").value
        if (actual_server_name != default_server) {
            window.location.search = 'room='+room_name.value+'&server='+actual_server_name
        } else {
            window.location.search = 'room='+room_name.value
        }
    })

    const btnJoin = document.getElementById('btn_join');
    btnJoin.addEventListener('click', async () => {

        divJoinRoomConfirm.style.display = "none"
        divWaitForConnection.style.display = "flex"

        btnJoin.disabled = true
        function on_success() {
            divWaitForConnection.style.display = "none"
            divControlButtons.style.display = "flex"
            divPeerList.style.display = "flex"
            divChat.style.display = "flex"
        }

        var host = document.getElementById("server_name").value
        var websocket_url = 'wss://' + host + '/ws'
        var room_name = inputRoomName.value
        var password = inputPassword.value
        var user_name = inputUserName.value
        // Start the client program.
        run(websocket_url,
            room_name,
            password,
            user_name,
            on_success, // on_success
            () => {}, // on_error
            () => {btnConnect.disabled = false},
            )
    })

    // Setup microphone-mute button.
    const btnToggleMute = document.getElementById('btnToggleMute');

    function setMuted(is_muted) {
        muted = is_muted
        if (muted) {
            info("You are now muted.")
            btnToggleMute.textContent = "Unmute"
        } else {
            info("You are now unmuted.")
            btnToggleMute.textContent = "Mute"
        }
    }

    setMuted(false)

    btnToggleMute.addEventListener('click', async () => {
        setMuted(!muted)
    })

    // Setup leave button.
    const btnLeave = document.getElementById('btnLeave');
    btnLeave.addEventListener('click', async () => {
        info("Leave the call.")
        // TODO
        window.location.search = ''
    })

    // Setup show-log button.
    const btnShowLog = document.getElementById('btnShowLog');
    const divLog = document.getElementById('divLog')

    var showLog = false

    function setShowLog(_showLog) {
        showLog = _showLog
        if (showLog) {
            divLog.style.display = "block"
            btnShowLog.textContent = "Hide Log"
        } else {
            divLog.style.display = "none"
            btnShowLog.textContent = "Show Log"
        }
    }

    setShowLog(false)

    // Toggle the log.
    btnShowLog.addEventListener('click', async () => {
        setShowLog(!showLog)
    })
}

// Run main.
main()
