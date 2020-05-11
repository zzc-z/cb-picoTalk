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
from typing import List, Optional
from .audio_processor import AudioProcessor


class Squelch(AudioProcessor):
    """
    Analyze signal to figure out if somebody is speaking.
    A audio frame is only propagated if speaking was detected.
    """

    def __init__(self, frame_size: int, sample_rate: int):
        self.frame_size = frame_size
        self.sample_rate = sample_rate

        self.min_power = float('Inf')
        self.transmission_countdown = 0

    async def process(self, frames: List[np.ndarray]) -> List[np.ndarray]:
        frames = [self.__process_single_frame(frame)
                  for frame in frames
                  ]
        return [f for f in frames if f is not None]

    def __process_single_frame(self, frame: Optional[np.ndarray]) -> Optional[np.ndarray]:

        if frame is None:
            return None

        assert frame.shape == (self.frame_size,), "Wrong frame size."

        signal = frame

        signal = signal - np.mean(signal)  # Remove DC component.
        power = np.mean(np.abs(signal ** 2))
        if power > 0:
            self.min_power = min(self.min_power, power)

        if power > self.min_power * 256:
            # Detected a signal, start transmitting for some time minimal time.
            min_tx_time = 2.0
            self.transmission_countdown = self.sample_rate * min_tx_time

        # Let the minimal power grow very slowly to be adaptive
        # in case the noise level gets higher.
        self.min_power *= 1.01

        if self.transmission_countdown > 0:
            self.transmission_countdown = self.transmission_countdown - self.frame_size
            return frame
        else:
            return None
