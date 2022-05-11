<!--
SPDX-FileCopyrightText: 2022 Thomas Kramer

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# The PicoTalk Protocol

This gives an outline of the protocols used by this project.

## Basic client-server communication

Client and server communication is packet based. The packets can be sent over different transports such as TCP, UDP or WebSockets. The rest of the protocol is (almost) agnostic of the transport used.

Each packet consists of a packet type, payload length, source address, destination address and payload data. Source and destination address are used for routing packets to other clients or 'peers' connected to the same room on the server.

There are three packet types: `binary`, `JSON` and `AudioFrame`. `binary` is used for sending binary encoded public keys, `JSON` is used for controll messages and also text chat messages, `AudioFrame` is used for transporting the actual audio data.

## Protocol

The server basically acts as a router for control and audio messages. Clients join a 'room' at the beginning of the connection. Messages are only routed within a room.

TBD

## End-to-end encryption (client-to-client)

All audio is end-to-end encrypted such that the server cannot listen to it. Also chat messages are end-to-end encrypted.

For end-to-end encryption to be robust against active adversaries it is necessary that the clients have some information that allows them to mutually proove that they have been invited to the same room. This is done with a password that should be distributed when inviting people to a call. The password is never sent to the server and is used to perform a 'password-authenticated key exchange' between the clients in a room. For the key exchange a protocol very similar to 'SPEKE' is used. It is basically a Diffie-Hellman key agreement using curve25519 from the NaCl library. However, instead of the normal public base point a pseudo-random base point is derived from the password.

Key exchanges are performed for each pair of clients in a room. Clients use the derived keys to build a point-to-point secure channel. This channel is used to distribute the audio encryption keys.

Audio frames are encrypted by element addition of a pseudo-random key-stream to the audio samples. Since the audio frames have constant size this allows them to be mixed on the server such that they still can be decrypted by the other clients.

*In the current version there is no integrity check yet. The server cannot listen to the audio but it can inject arbitrary audio signals.*

## Transport encryption (client-to-server)

Due to the end-to-end encryption the content secrecy of the voice call does *not* rely on the client-to-server encryption.

Packets between the client and server are additionally encrypted with a secure channel protocol built around NaCl.

**Note**: The current transport encryption does not resist man-in-the-middle attacks because the server identity key is not checked.

The server identity keypair is still generated on the fly and is not persistent yet! The protocol (triple-DH) is designed to support a combination of a persistent identity keypair and a ephemeral keypair (for forward secrecy). The idea is that clients could do trust-on-first-sight: They could remember the server identity(if it would be persistent) and then notice future man in the middle attacks.

### HTTPS
For the web user interface the connection to the server can and should be additionally TLS-encrypted.
