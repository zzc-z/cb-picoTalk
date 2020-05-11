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
from typing import Callable, Coroutine
from .packet import TLVPacket
from .base import Connection

logger = logging.getLogger("TcpTransport")


class TcpConnection(Connection):

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        super().__init__()
        self.reader = reader
        self.writer = writer

    async def read_packet(self) -> TLVPacket:
        p = await TLVPacket.read_async(self.reader)
        return p

    async def write_packet(self, p: TLVPacket):
        self.writer.write(p.encode())
        await self.writer.drain()

    def close(self):
        self.writer.close()


async def run_tcp_server(
        handle_connection: Callable[[Connection], Coroutine],
        server_addr: str,
        server_port: int):
    logger.info(f"Starting TCP server on {server_addr}:{server_port}")

    async def handle_tcp_connection(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        conn = TcpConnection(reader, writer)
        try:
            await handle_connection(conn)
        except ConnectionError as e:
            logger.debug(e)
        except Exception as e:
            logger.debug(e)

    server = await asyncio.start_server(
        handle_tcp_connection,
        server_addr,
        server_port
    )

    addr, port = server.sockets[0].getsockname()
    logger.info(f"TCP server listening on {addr}:{port}")

    async with server:
        await server.serve_forever()


async def open_tcp_connection(server_addr: str, server_port: int) -> TcpConnection:
    """
    Open a packet oriented TCP connection to the server.
    """
    logger.debug(f'Connecting to {server_addr}:{server_port}.')
    reader, writer = await asyncio.open_connection(
        server_addr, server_port)
    logger.debug(f'Connected to {server_addr}:{server_port}.')

    conn = TcpConnection(reader, writer)
    conn.set_extra_info("peername", writer.get_extra_info("peername"))
    return conn
