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
Abstraction layer for network connections.

Network connections are abstracted as (not necessarily reliable) packet based connections.
"""

import logging
from .packet import TLVPacket

logger = logging.getLogger('PacketTransport')


class Connection:
    """
    Base class of connection instances.
    """

    def __init__(self):
        self._is_closed = False
        self._extra_info = dict()

    async def read_packet(self) -> TLVPacket:
        raise NotImplementedError

    async def write_packet(self, data: TLVPacket):
        raise NotImplementedError

    def is_closed(self) -> bool:
        return self._is_closed

    def close(self):
        self._is_closed = True

    def get_extra_info(self, key):
        return self._extra_info.get(key)

    def set_extra_info(self, key, value):
        self._extra_info[key] = value
