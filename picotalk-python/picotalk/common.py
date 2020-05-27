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
import numpy as np

version = 0, 0, 20

# Default server port.
server_tcp_port = 9999
server_udp_port = 9999
server_websocket_port = 9998

# Audio format.
sample_rate = 16000 #2 ** 14
# Number of audio channels.
num_channels = 1
# Number of samples in an audio frame.
frame_size = 512
# Audio sample data type.
sample_data_type = np.dtype(np.int16).newbyteorder('<')
# Size of a sample in bytes.
sample_size = 2

# Data type of audio meta tags.
# This describes the data structures used for encryption appended to each audio frame.
audio_tag_data_type = np.dtype([('peer_id', np.uint16), ('nonce', np.uint32)]).newbyteorder('>')

# Numpy data types.
uint8_t = np.dtype(np.uint8).newbyteorder('>')
uint16_t = np.dtype(np.uint16).newbyteorder('>')

# Identification (address) of server.
server_id = 1