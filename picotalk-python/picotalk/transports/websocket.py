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

"""
Implement packet transport over WebSockets.
"""

import logging
from typing import Any, Callable, Coroutine
from .packet import TLVPacket
from .base import Connection
import aiohttp.web

logger = logging.getLogger("WebSocketTransport")


class WebSocketConnection(Connection):
    """
    Abstraction over WebSocket connections.
    """

    def __init__(self, ws: aiohttp.web.WebSocketResponse):
        super().__init__()
        self.ws = ws

    async def read_packet(self) -> TLVPacket:
        data = await self.ws.receive_bytes()
        p = TLVPacket.from_buffer(data)
        return p

    async def write_packet(self, p: TLVPacket):
        await self.ws.send_bytes(p.encode())

    def close(self):
        self.ws.close()


async def run_websocket_server(
        handle_connection: Callable[[Connection], Coroutine],
        host: str,
        port: int):
    logger.info(f"Starting WebSocket server on {host}:{port}")

    async def websocket_handler(request):
        logger.debug('Websocket connection starting.')
        ws = aiohttp.web.WebSocketResponse()
        await ws.prepare(request)
        logger.debug('Websocket connection ready.')

        conn = WebSocketConnection(ws)
        await handle_connection(conn)
        return ws

    app = aiohttp.web.Application()
    app.router.add_route('GET', '/ws', websocket_handler)

    await aiohttp.web._run_app(app, host=host, port=port)
