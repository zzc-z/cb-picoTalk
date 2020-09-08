#
# Copyright (c) 2020 Thomas Kramer.
#
# This file is part of picoTalk 
# (see https://codeberg.org/tok/picotalk).
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>.
#
import asyncio
import logging
import sys
import time
import numpy as np
from typing import Any, Callable, Dict, Set
import argparse
import itertools
from nacl.public import PublicKey, PrivateKey, Box

from . import common
from .transports.packet import TLVPacket, PacketType
from .transports.base import Connection
from .transports import udp as transport_udp, tcp as transport_tcp, websocket as transport_ws, \
    encrypted as transport_enc

logger_format = '%(asctime)-15s %(name)s %(levelname)s %(message)s'

logging.basicConfig(level=logging.DEBUG, stream=sys.stdout, format=logger_format)
logger = logging.getLogger('Main')

# Enable direct echo back to peer.
debug_echo = False


class Room:
    """
    Mixes together the audio streams of the peers.
    """

    def __init__(self, room_id: str, on_close: Callable[[], None]):
        """
        :param room_id: ID of the room.
        :param on_close: Callback that will be called when the room is closed.
        """
        self.room_id: str = room_id

        # Create a separate logger for each room.
        self.logger = logging.getLogger("{}({})".format(type(self).__name__, room_id))

        # All clients in this room stored by their ID.
        self.peers: Dict[int, Client] = dict()
        # Set of peer IDs that have been authenticated by existing authenticated peers (with the password).
        self.authenticated_peers: Set[int] = set()

        # Function to be called when the room is closed.
        self.on_close: Callable[[], None] = on_close

        # Counter for generating unique peer IDs.
        # ID '0' is reserved as a placeholder for 'undefined' IDs.
        # ID '1' is reserved for the server.
        self.user_id_generator = itertools.count(2)

        # Flag to signal that all peers left the room
        # and the room will be closed.
        self.is_closed = False

        # Generate ephemeral room key pair.
        self.__private_key: PrivateKey = PrivateKey.generate()
        self.public_key: PublicKey = self.__private_key.public_key

    async def broadcast(self, packet: TLVPacket, peers=None):
        """
        Send a packet to all connected peers or optionally only to a selection given
        in the `peers` list.
        """
        if peers is None:
            # Take a snapshot of current peers.
            peers = list(self.peers.values())

        # TODO: What if the peer gets removed in the meantime?
        tasks = [p.conn.write_packet(packet) for p in peers]
        for t in tasks:
            await t

    async def authenticate_peer(self, peer_id: int):
        if peer_id not in self.authenticated_peers:
            self.authenticated_peers.add(peer_id)

            # Notify all other peers of the authenticated peer.
            p = TLVPacket.from_dict(
                event='peer_authenticated',
                peer_id=peer_id
            )
            p.src_addr = common.server_id
            asyncio.create_task(self.broadcast(p))

    async def register_peer(self, peer):
        """
        Create an input and an output data queue for this peer.

        :returns: Returns the peer id.
        """
        assert isinstance(peer, Client)

        assert not self.is_closed, "Room has been closed."

        if peer not in self.peers:
            # Generate user id.
            peer_id = next(self.user_id_generator)
            peer.peer_id = peer_id

            # Remember a list of the previous peers.
            old_peers = list(self.peers.values())

            # Announce the new peer to the other peers.
            p = TLVPacket.from_dict(
                event='peer_joined',
                peer_id=peer_id
            )
            p.src_addr = common.server_id
            asyncio.create_task(self.broadcast(p, old_peers))

            self.peers[peer_id] = peer
            self.logger.info(f"Registered peer {peer}")

            # The first to enter a room is automatically authenticated.
            if len(self.authenticated_peers) == 0:
                await self.authenticate_peer(peer_id)

        else:
            msg = f"Peer is already registered {peer}"
            self.logger.error(msg)
            raise Exception(msg)

    def remove_peer(self, peer) -> None:
        assert isinstance(peer, Client)

        if peer.peer_id in self.peers:
            del self.peers[peer.peer_id]

            # if peer.peer_id in self.authenticated_peers:
            #     self.authenticated_peers.remove(peer.peer_id)

            # Notify the other peers that somebody disconnected.
            p = TLVPacket.from_dict(
                event='peer_disconnected',
                peer_id=peer.peer_id
            )
            p.src_addr = common.server_id
            asyncio.create_task(self.broadcast(p))

        self.logger.info(f"Removed peer {peer}")

        if len(self.peers) == 0:
            self.is_closed = True
            self.logger.info(f"Closing the room: {self.room_id}")
            self.on_close()

    def is_peer_authenticated(self, peer_id: int):
        """
        Test if the peer with this ID has been authenticated by the other peers.
        Authentication should happen after the peer successfully run the
        key exchange with an already authenticated peer.
        The first peer in the room is authenticated by default.
        :param peer_id:
        :return:
        """
        return peer_id in self.authenticated_peers

    async def handle_control_packet(self, packet: TLVPacket):

        src_peer_id = packet.src_addr

        # Accept only commands of authenticated peers.
        if self.is_peer_authenticated(src_peer_id):
            if packet.type == PacketType.JSON:
                d = packet.to_dict()
                event = d.get('event')
                if event == "peer_authenticated":
                    peer_id = d.get('peer_id')
                    logger.debug(f"Peer {peer_id} is authenticated.")
                    await self.authenticate_peer(peer_id)
                    pass
            else:
                logger.debug(f"Not handling packet of type {packet.type}")

    async def handle_addressed_packet(self, packet: TLVPacket):
        """
        Handle a packet that is addressed to another peer.
        :param packet:
        """

        assert not self.is_closed, "Room has been closed."

        dest_addr = packet.dest_addr

        if dest_addr == common.server_id:
            assert "This should have been handled before."
        else:
            # This packet is for another peer.
            # Forward the packet if the destination peer is known.
            dest_peer = self.peers.get(dest_addr)
            if dest_peer is not None:
                # Forward the packet to the destination.
                await dest_peer.conn.write_packet(packet)
            else:
                logger.debug(f'Destination not known {dest_addr}.')

    async def run_audio_mixer(self):
        """
        Mixes together the audio streams of the peers.
        """
        # Generate a chunk of silence.
        silence = np.zeros(common.frame_size, dtype=common.sample_data_type)

        chunk_duration = common.frame_size / common.sample_rate

        # Time of the next audio chunk.
        next_chunk_time = time.time()

        while not self.is_closed:
            # Make sure this loop is executed as periodically as possible.
            slack = next_chunk_time - time.time()
            if slack > 0:
                # Have to wait...
                await asyncio.sleep(slack)
            next_chunk_time += chunk_duration

            # Read all available chunks.
            current_frames_and_tags = dict()
            for peer in self.peers.values():
                q = peer.audio_queue_input

                if q.full():
                    # Have to catch up with latency and drop a frame.
                    logger.debug("Drop frame to catch up with latency.")
                    q.get_nowait()

                if q.qsize() > 0:
                    frame, tag = q.get_nowait()
                    assert isinstance(frame, np.ndarray)
                    assert isinstance(tags, np.ndarray)
                    if frame.shape == (common.frame_size,):
                        current_frames_and_tags[peer] = frame, tag
                    else:
                        logger.debug(f"Skip frame of size {frame.shape}")

            # Compute output chunks for each peer.
            # And send the chunk to the peer.
            for peer_out in self.peers.values():

                # Sum all chunks that don't come from the destination.
                tags = []
                output_frame = silence.copy()

                for peer, (frame, tag) in current_frames_and_tags.items():
                    if peer != peer_out or debug_echo:  # Send back the audio of this peer to herself if debug_echo is set.
                        output_frame += frame
                        tags.append(tag)  # Remember who are the senders and which nonces did they use.

                # Convert to a numpy array.
                tags = np.array(tags)

                out = peer_out.audio_queue_output
                if out.full():
                    # Drop oldest chunk if the queue is full.
                    logger.debug('Output queue is full. Dropping oldest packet.')
                    out.get_nowait()
                out.put_nowait((output_frame, tags))

        logger.debug("Mixer task ended.")


# Singleton dictionary of rooms.
rooms: Dict[str, Room] = dict()


def get_or_create_room(room_id: str) -> Room:
    """
    Get a room by the name or create one if it does not yet exist.
    """
    if room_id in rooms:
        logger.info(f'Get room: {room_id}')
        room = rooms[room_id]
    else:
        logger.info(f'Create room: {room_id}')

        def on_close_callback():
            # This is called once all users left a room.
            # Delete the room.
            logger.info(f'on_close_callback(): Remove room "{room_id}"')
            if room_id in rooms:
                del rooms[room_id]

        room = Room(room_id=room_id, on_close=on_close_callback)
        rooms[room_id] = room

        logger.debug('Launch mixer task.')
        # Run the mixer in the background.
        asyncio.create_task(room.run_audio_mixer())

    return room


class Client:

    def __init__(self, addr: Any,
                 conn: Connection,
                 udp_router: transport_udp.UdpPacketRouter
                 ):
        """
        :param addr: Client address likely as an (ip, port) tuple.
        :param conn: Client connection.
        """

        self.addr: Any = addr

        # Insecure connection.
        self.conn_insecure: Connection = conn
        # Secure connection.
        self.conn: transport_enc.SecureConnection = None

        self.udp_router: transport_udp.UdpPacketRouter = udp_router

        self.peer_id: int = 0

        # Audio queues to and from the mixer.
        audio_queue_size = 5
        self.audio_queue_input: asyncio.Queue = asyncio.Queue(maxsize=audio_queue_size)
        self.audio_queue_output: asyncio.Queue = asyncio.Queue(maxsize=audio_queue_size)

    def __repr__(self):
        return f"Client(id = {self.peer_id}, addr = {self.addr})"

    def __str__(self):
        return repr(self)

    async def protocol_00_send_hello(self):
        # Write server-hello message.
        # <- version
        await self.conn_insecure.write_packet(
            TLVPacket.from_dict(version=common.version)
        )

    async def protocol_02_read_client_hello(self) -> str:
        """
        :returns: ID of the room which the client wants to join.
        """
        # Read client-hello message.
        # -> hello packet
        logger.debug('Waiting for client-hello message.')
        hello_packet = await self.conn.read_packet()
        logger.debug('Hello packet: {}'.format(hello_packet.to_dict()))

        # Parse hello packet into JSON.
        hello_data = hello_packet.to_dict()

        # Read room name from the client-hello message.
        room_id = hello_data['room_id']
        logger.info(f'Peer wants to join room "{room_id}"')

        return room_id

    async def handle_audio_packet(self, p: TLVPacket):
        """
        Handle an incoming audio frame.
        The audio frame is forwarded to the audio mixer of the room via a queue.
        """
        # Handle an audio frame packet.

        data = p.data
        audio_data = data[:common.frame_size * common.sample_size]
        tag_data = data[common.frame_size * common.sample_size:]
        # Convert frame to a numpy array.
        frame = np.frombuffer(audio_data, dtype=common.sample_data_type).astype(np.int)
        audio_tags = np.frombuffer(tag_data, dtype=common.audio_tag_data_type)

        assert len(audio_tags) == 1, "Peer should attach exactly one tag."
        audio_tag = audio_tags[0]
        assert audio_tag[
                   'peer_id'] == self.peer_id, f"Peer should not lie about its own peer_id ({audio_tag['peer_id']})."

        await self.audio_queue_input.put((frame, audio_tag))

    async def run_connection(self):
        """
        Handle the connection to the client.
        """
        logger.debug("Start client connection protocol.")

        # Send hello message to client.
        await self.protocol_00_send_hello()

        # Derive shared secret.
        box = await transport_enc.authenticated_key_exchange(self.conn_insecure, initiator_role=False)

        # Setup encrypted connection.
        self.conn = transport_enc.SecureConnection(box, self.conn_insecure, is_initiator=False, nonce=1)

        # Read client-hello message.
        room_id = await self.protocol_02_read_client_hello()

        # Get or create the room.
        room = get_or_create_room(room_id)

        # Get data queues from and to mixer.
        await room.register_peer(self)
        assert self.peer_id != 0  # ID should be set now.

        try:
            # Generate a fresh stream ID for routing the UDP packets.
            udp_stream_id = transport_udp.UdpPacketRouter.random_stream_id()

            # Create a UDP connection.
            udp_conn = transport_udp.UdpConnection(self.udp_router, stream_id=udp_stream_id,
                                                   dest_addr=None)
            # Create encrypted UDP connection which allows packets to be lost
            # but enforces packets to remain ordered.
            udp_conn = transport_enc.SecureConnection(box, udp_conn,
                                                      is_initiator=False, nonce=2,
                                                      permit_dropped_packets=True)

            # Send accept-message to the client.
            await self.conn.write_packet(
                TLVPacket.from_dict(
                    user_id=self.peer_id,
                    udp_port=common.server_udp_port,  # TODO: specify this as argument.
                    udp_stream_id=udp_stream_id
                )
            )

            client_shutdown = asyncio.Event()

            async def receiver_task(receive_packet):
                """
                Read data from the `reader` and push it into the queue.
                """
                logger.debug("Starting receiver task.")
                try:
                    while not client_shutdown.is_set():
                        packet = await receive_packet()

                        # Remember where the packet came from.
                        # This is important. Don't let the client
                        # fake it's ID.
                        packet.src_addr = self.peer_id

                        if packet.dest_addr == common.server_id:
                            # Handle packets directed to server.
                            if packet.type == PacketType.AudioFrame:
                                if room.is_peer_authenticated(self.peer_id):
                                    # Handle audio packet only if the peer is authenticated.
                                    await self.handle_audio_packet(packet)
                            elif packet.type == PacketType.JSON:
                                # This packet is for the server.
                                await room.handle_control_packet(packet)
                            else:
                                logger.info(f"Packet type not handled: {packet.type}")
                        else:
                            # Handle packets directed to another peer.
                            await room.handle_addressed_packet(packet)
                except ConnectionError as e:
                    logger.info(f"Connection aborted: {self.addr}")
                except asyncio.IncompleteReadError as e:
                    logger.info(f"Incomplete read error: {e}")
                    logger.info(f"Connection closed: {self.addr}")
                except AssertionError as e:
                    logger.error(e)
                except Exception as e:
                    logger.info("Receiver task ended: {}".format(type(e)))
                finally:
                    if not client_shutdown.is_set():
                        # Send a signal to terminate this client connection.
                        client_shutdown.set()
                logger.debug("Receiver task ended.")

            async def audio_sender_task(send_packet, audio_queue: asyncio.Queue):
                """
                Take data from the queue and send it to the client.
                """
                try:
                    while not client_shutdown.is_set():
                        frame, tags = await audio_queue.get()
                        assert isinstance(frame, np.ndarray)
                        assert isinstance(tags, np.ndarray)
                        data = frame.tobytes() + tags.tobytes()
                        packet = TLVPacket(PacketType.AudioFrame, data)
                        await send_packet(packet)
                except ConnectionError as e:
                    logger.info(f"Connection aborted: {self.addr}")
                except Exception as e:
                    logger.info("Audio sender task ended: {}".format(type(e)))
                finally:
                    if not client_shutdown.is_set():
                        # Send a signal to terminate this client connection.
                        client_shutdown.set()

                logger.debug("Audio writer task ended.")

            # Wait for client to ask to use the UDP connection.
            try:
                client_udp_request = await asyncio.wait_for(udp_conn.read_packet(), 2)
                msg = client_udp_request.to_dict()
                logger.info(f"Client UDP check init message: {msg}")
                if msg.get('udp_check') == 'init':
                    # Acknowledge to client to use UDP.
                    p = TLVPacket.from_dict(udp_check='ok')
                    p.src_addr = common.server_id
                    await udp_conn.write_packet(p)
                else:
                    # Message should contain udp_check='init'!
                    pass
            except asyncio.TimeoutError:
                # Tell the client not to use UDP.
                p = TLVPacket.from_dict(udp_check='failed')
                p.src_addr = common.server_id
                await self.conn.write_packet(p)

            use_udp = False
            # Wait for client to decide whether to use UDP or not.
            client_udp_request = await self.conn.read_packet()
            msg = client_udp_request.to_dict()
            if msg['use_udp']:
                use_udp = True

            logger.info(f"Use UDP for client {self.peer_id}: {use_udp}")

            if not use_udp:
                # UDP connection will not be used. Close it.
                udp_conn.close()

            all_tasks = []

            # Start reader and writer task.
            _receiver_task = asyncio.create_task(receiver_task(
                self.conn.read_packet
            ))
            all_tasks.append(_receiver_task)

            if use_udp:
                # Start reader on UDP connection.
                _udp_receiver_task = asyncio.create_task(receiver_task(
                    udp_conn.read_packet
                ))
                all_tasks.append(_udp_receiver_task)

            # Start audio sender task.
            _audio_sender_task = asyncio.create_task(audio_sender_task(
                udp_conn.write_packet if use_udp else self.conn.write_packet,
                self.audio_queue_output
            ))

            all_tasks.append(_audio_sender_task)

            # Wait until one of the tasks terminates.
            await client_shutdown.wait()

            # Terminate the other tasks if the signalling task terminates.
            for t in all_tasks:
                t.cancel()
        except Exception as e:
            logger.debug(f"Exception: {e}")
        finally:
            # Tear down the UDP stream.
            udp_conn.close()
            # Remove this peer from the room.
            room.remove_peer(self)

            logger.debug("Client connection protocol ended.")


async def run_tcp_server(server_addr: str, server_port: int, udp_router: transport_udp.UdpPacketRouter):
    logger.info(f"Starting TCP server on {server_addr}:{server_port}")

    async def handle_client_tcp(conn: Connection):
        """
        Handle a raw TCP connection to a client.
        """

        addr = conn.get_extra_info('peername')
        logger.info(f"Handle client {addr}")

        client = Client(addr=addr,
                        conn=conn,
                        udp_router=udp_router
                        )

        client_task = asyncio.create_task(client.run_connection())
        await client_task
        logger.info(f"Handle client finished {addr}")
        conn.close()

    await transport_tcp.run_tcp_server(
        handle_client_tcp,
        server_addr,
        server_port
    )


async def run_websocket_server(server_addr: str, server_port: int, udp_router: transport_udp.UdpPacketRouter):
    logger.info(f"Starting WebSocket server on {server_addr}:{server_port}")

    async def handle_connection(conn: Connection):
        """
        Handle a raw WebSocket connection to a client.
        """

        addr = conn.get_extra_info('peername')
        logger.info(f"Handle client {addr}")

        client = Client(addr=addr,
                        conn=conn,
                        udp_router=udp_router
                        )

        client_task = asyncio.create_task(client.run_connection())
        await client_task
        logger.info(f"Handle client finished {addr}")
        conn.close()

    await transport_ws.run_websocket_server(
        handle_connection,
        server_addr,
        server_port
    )


async def print_stats(interval: int = 60):
    """
    Print server usage statistics in regular intervals.
    """

    while True:
        await asyncio.sleep(interval)
        num_rooms = len(rooms)
        logger.info(f"Number of open rooms: {num_rooms}")
        num_clients = sum((len(r.peers) for r in rooms.values()))
        logger.info(f"Total client connections: {num_clients}")
        num_clients_max = max((len(r.peers) for r in rooms.values()), default=0)
        logger.info(f"Largest room: {num_clients_max}")


async def run_server(server_addr: str, server_tcp_port: int, server_udp_port: int, server_websocket_port: int):
    # Start statistic logger tasks.
    asyncio.create_task(print_stats(60))
    # Open UDP transport.
    udp_router = await transport_udp.run_udp_server(None, server_addr, server_udp_port)
    # udp_packet_router.transport = udp_transport
    task_tcp = asyncio.create_task(run_tcp_server(server_addr, server_tcp_port, udp_router=udp_router))
    task_ws = asyncio.create_task(run_websocket_server(server_addr, server_websocket_port, udp_router=udp_router))
    await task_tcp
    await task_ws
    logger.info("Server stopped.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-l', '--listen', type=str,
                        metavar='ADDR',
                        default='0.0.0.0',
                        help="Listen address.")
    parser.add_argument('-p', '--port', type=int,
                        metavar='TCP_LISTEN_PORT',
                        default=common.server_tcp_port,
                        help="Listening port.")
    parser.add_argument('-u', '--udp-port', type=int,
                        metavar='UDP_LISTEN_PORT',
                        default=common.server_udp_port,
                        help="Listening port.")
    parser.add_argument('--ws-port', type=int,
                        metavar='WEBSOCKET_LISTEN_PORT',
                        default=common.server_websocket_port,
                        help="Listening port of the WebSocket server.")
    parser.add_argument('--echo', action='store_true',
                        help="Enable direct echo for debugging.")
    parser.add_argument('--uvloop', action='store_true',
                        help="Use 'uvloop' as eventloop.")
    args = parser.parse_args()

    if args.uvloop:
        try:
            # Try to use `uvloop` if it is installed.
            # uvloop could lead to better performance.
            import uvloop

            asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
            logger.info("Using 'uvloop'.")
        except ImportError as e:
            logger.info("'uvloop' is not available.")

    global debug_echo
    debug_echo = args.echo

    if debug_echo:
        logger.warning("Running with direct echo turned on.")

    loop = asyncio.get_event_loop()

    loop.run_until_complete(run_server(server_addr=args.listen,
                                       server_tcp_port=args.port,
                                       server_udp_port=args.udp_port,
                                       server_websocket_port=args.ws_port)
                            )


if __name__ == '__main__':
    main()
