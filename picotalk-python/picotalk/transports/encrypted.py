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
Secure channel as a wrapper around a `Connection`.
"""

import struct
import logging
from typing import Optional, Union, Tuple
from nacl.public import Box, PrivateKey, PublicKey
from nacl.secret import SecretBox
from nacl.exceptions import CryptoError
import nacl.utils
import nacl.hash
import nacl.secret
import nacl.encoding
from nacl.bindings.crypto_scalarmult import crypto_scalarmult, crypto_scalarmult_base
from .packet import TLVPacket, PacketType
from .base import Connection

logger = logging.getLogger("secure connection")


class SecureConnection(Connection):
    """
    Wrapper around a connection.
    Additionally to encrypting and authenticating packets also makes
    sure that packets can only be decrypted in the correct order.
    No replay attack possible.
    """

    # Used to create the nonce from connection_id, role and counter.
    _nonce_struct = struct.Struct(">BBQ")
    _counter_struct = struct.Struct(">Q")

    def __init__(self, box: Union[nacl.public.Box, nacl.secret.SecretBox],
                 conn: Connection,
                 is_initiator: bool,
                 nonce: int,
                 permit_dropped_packets: bool = False,
                 logger: Optional[logging.Logger] = None):
        """
        :param conn: Underlying connection.
        :param is_initiator: Tell if this instance is the protocol initiator.
            Needed against packet mirroring attacks.
        :param permit_dropped_packets: Allow to skip packets.
            However, packets will not be accepted in a different order.
        """
        super().__init__()
        self.__conn = conn
        assert isinstance(box, Box) or isinstance(box, SecretBox)
        self.__box = box
        self.__role = 1 if is_initiator else 2
        self.__role_other = 2 if is_initiator else 1
        self.__counter = 1
        self.__counter_other = 1

        assert 0 <= nonce < 256
        self.__nonce = nonce

        self.permit_dropped_packets = permit_dropped_packets

        self.logger = logger

    @staticmethod
    def __create_nonce(connection_id: int, role: int, counter: int) -> bytes:
        nonce_bytes = SecureConnection._nonce_struct.pack(connection_id, role, counter)
        # random_bytes = nacl.utils.random(24 - 2 - 8)
        nonce_bytes = nonce_bytes + b"\00" * 14
        assert len(nonce_bytes) == 24
        return nonce_bytes

    @staticmethod
    def __parse_nonce(nonce: bytes) -> Tuple[int, int, int]:
        assert len(nonce) == 24
        connection_id, role, counter = SecureConnection._nonce_struct.unpack_from(nonce)
        return connection_id, role, counter

    async def read_packet(self) -> TLVPacket:
        """
        Receive packets and try to decrypt them.
        The first packet that successfully decrypts is returned.
        """
        while True:
            # Try to receive and decrypt a packet.
            p_encrypted = await self.__conn.read_packet()
            counter = self.__counter_other
            try:
                data = p_encrypted.data

                if self.permit_dropped_packets:
                    # Strip away the counter.
                    counter_bytes, data = data[:8], data[8:]
                    counter_received, = SecureConnection._counter_struct.unpack(counter_bytes)
                    # Make sure the counter is monotonic.
                    counter = max(counter_received, self.__counter_other)

                nonce = self.__create_nonce(self.__nonce, self.__role_other, counter)

                # Decrypt the packet.
                p = TLVPacket.from_buffer(
                    self.__box.decrypt(data, nonce=nonce)
                )
                # Monotonically increase the counter.
                assert self.__counter_other < counter + 1
                self.__counter_other = counter + 1  # Compute next nonce on successful decryption.
                return p
            except nacl.exceptions.CryptoError as e:
                # Drop all invalid packets.
                if self.logger is not None:
                    self.logger.debug("CryptoError: dropping packet.")

    async def write_packet(self, p: TLVPacket):
        """
        Send a packet.
        """
        nonce = self.__create_nonce(self.__nonce, self.__role, self.__counter)

        data_encrypted = self.__box.encrypt(p.encode(), nonce=nonce)
        # Strip away the nonce.
        data_encrypted = data_encrypted[24:]

        if self.permit_dropped_packets:
            # Prepend the counter.
            counter_bytes = SecureConnection._counter_struct.pack(self.__counter)
            assert len(counter_bytes) == 8
            data_encrypted = counter_bytes + data_encrypted

        p_encrypted = TLVPacket(
            PacketType.Binary,
            data_encrypted
        )
        self.__counter += 1  # Increment nonce after encryption.
        await self.__conn.write_packet(p_encrypted)

    def close(self):
        """
        Close the connection and the underlying connection.
        """
        super().close()
        self.__conn.close()


async def authenticated_key_exchange(conn: Connection,
                                     initiator_role: bool,
                                     other_identity_key: Optional[nacl.public.PublicKey] = None,
                                     private_identity_key: Optional[nacl.public.PrivateKey] = None
                                     ) -> nacl.secret.SecretBox:
    """
    Do a triple-DH authenticated key exchange to derive a foward-secret shared key.

    :param conn: Underlying insecure connection.
    :param identity_key: Identity key of the other peer.
    :param private_identity_key: Long-term private key.
    """

    # Generate ephemeral client key pair.
    private_key: PrivateKey = PrivateKey.generate()
    public_key: PublicKey = private_key.public_key

    if private_identity_key is None:
        # Generate a temporary 'fake' identity key.
        private_identity_key = PrivateKey.generate()
    public_identity_key = private_identity_key.public_key

    # Send client-key message.
    logger.debug("Send public keys.")
    tx = conn.write_packet(TLVPacket(PacketType.Binary,
                                     public_identity_key.encode() + public_key.encode()
                                     ))

    # Receive public key message.
    logger.debug("Receive public key.")
    rx = conn.read_packet()

    await tx
    msg = await rx
    if msg.type != PacketType.Binary:
        raise Exception("Wrong message type.")
    if len(msg.data) != 64:
        raise Exception("Wrong public key length.")
    public_identity_key_other = nacl.public.PublicKey(msg.data[:32])
    public_key_other = nacl.public.PublicKey(msg.data[32:])

    if other_identity_key is not None:
        if other_identity_key != public_identity_key_other:
            raise Exception("Identity key does not match!")

    # Derive shared key.
    box1 = Box(private_identity_key, public_key_other)
    box2 = Box(private_key, public_identity_key_other)
    box3 = Box(private_key, public_key_other)
    del private_key

    if initiator_role:
        shared_secret = nacl.hash.sha512(box1.shared_key() + box2.shared_key() + box3.shared_key(),
                                         encoder=nacl.encoding.RawEncoder)
    else:
        shared_secret = nacl.hash.sha512(box2.shared_key() + box1.shared_key() + box3.shared_key(),
                                         encoder=nacl.encoding.RawEncoder)

    key = shared_secret[:32]

    return nacl.secret.SecretBox(key)


class SPEKE:
    """
    SPEKE: Simple password exponential key exchange.
    """

    def __init__(self, password: bytes):
        p = nacl.hash.sha512(password,
                             encoder=nacl.encoding.RawEncoder)[:32]
        # Compute base point from the hashed password: P = pG
        self.generator = crypto_scalarmult_base(p)
        self.__private_key = None

    def generate_public_key(self) -> bytes:
        """
        Generate fresh key pair based on password.
        This key pair can be used for at most one key exchange.
        """
        # Generate fresh private key.
        self.__private_key = nacl.utils.random(32)
        public_key = crypto_scalarmult(self.__private_key, self.generator)
        return public_key

    def compute_shared_key(self, other_public: bytes) -> bytes:
        """
        Compute a shared secret based on another public key.
        This can be called only once after creating a new key pair.
        """
        assert self.__private_key is not None, f"Must call `{self.generate_public_key.__name__}` first."
        s = crypto_scalarmult(self.__private_key, other_public)
        # Make sure this secret key is only used once.
        self.__private_key = None

        # Compute the hash of the shared secret.
        s_hashed = nacl.hash.sha512(s, encoder=nacl.encoding.RawEncoder)

        return s_hashed


async def password_authenticated_key_exchange(conn: Connection,
                                              password: bytes) -> bytes:
    """
    Do a password authenticated key exchange to derive a shared secret key.

    :param conn: Underlying insecure connection.
    """

    speke = SPEKE(password=password)

    public_key = speke.generate_public_key()

    # Send client-key message.
    logger.debug("Send public key.")
    tx = conn.write_packet(TLVPacket(PacketType.Binary, public_key))

    # Receive public key message.
    logger.debug("Receive public key.")
    rx = conn.read_packet()

    await tx
    msg = await rx
    if msg.type != PacketType.Binary:
        raise Exception(f"Wrong message type ({msg.type}).")
    if len(msg.data) != 32:
        raise Exception("Wrong public key length.")
    public_key_other = msg.data

    shared_secret = speke.compute_shared_key(public_key_other)

    return shared_secret[:32]
